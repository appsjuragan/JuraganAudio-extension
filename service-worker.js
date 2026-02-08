// Service Worker for JuraganAudio Toolkit (Manifest V3) with Quality Modes

import { state, initState, K, z, H, PRESETS_PREFIX } from './modules/service_worker/state.js';
import { ensureOffscreen } from './modules/service_worker/offscreen.js';
import { sendFullStatus, handleSavePreset, handleDeletePreset, handleImportPresets } from './modules/service_worker/messaging.js';

// Message Listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Offscreen to SW updates
    if (msg.type === "streamStarted") {
        if (!state.activeStreams.includes(msg.tabId)) {
            state.activeStreams.push(msg.tabId);
        }
        sendFullStatus();
        return;
    }
    if (msg.type === "streamEnded") {
        state.activeStreams = state.activeStreams.filter(id => id !== msg.tabId);
        sendFullStatus();
        return;
    }

    // Capture tab specific enrichment
    if (msg.type === 'eqTab' && msg.on === false && !msg.tabId) {
        chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length) {
                msg.tabId = tabs[0].id;
                ensureOffscreen().then(() => chrome.runtime.sendMessage(msg));
            }
        });
        return;
    }

    // Messages that require AudioContext/TabCapture must go to offscreen
    const offscreenMessages = [
        'eqTab',
        'modifyFilter',
        'modifyGain',
        'resetFilters',
        'resetFilter',
        'preset',
        'setQualityMode',
        'setSbrOptions',
        'setLimiterOptions',
        'setVisualizerFps'
    ];

    if (offscreenMessages.includes(msg.type)) {
        // Track local state changes for persistence
        if (msg.type === 'modifyFilter') {
            state.filters[msg.index] = { f: msg.frequency, g: msg.gain, q: msg.q };
            chrome.storage.local.set({ ["filter" + msg.index]: JSON.stringify(state.filters[msg.index]) });
        } else if (msg.type === 'modifyGain') {
            state.gain = msg.gain;
            chrome.storage.local.set({ "GAIN": JSON.stringify(state.gain) });
        } else if (msg.type === 'resetFilters') {
            state.gain = 1;
            state.filters = z.map((f, i) => ({ f: f, g: 0, q: H[i] }));
            const saveObj = { "GAIN": JSON.stringify(1) };
            for (let j = 0; j < K; j++) saveObj["filter" + j] = JSON.stringify(state.filters[j]);
            chrome.storage.local.set(saveObj);
        } else if (msg.type === 'setQualityMode') {
            state.qualityMode = msg.mode;
            chrome.storage.local.set({ "QUALITY_MODE": msg.mode });
        } else if (msg.type === 'setSbrOptions') {
            state.sbrOptions = msg.options;
            chrome.storage.local.set({ "SBR_OPTIONS": JSON.stringify(state.sbrOptions) });
        } else if (msg.type === 'setLimiterOptions') {
            state.limiterOptions = msg.options;
            chrome.storage.local.set({ "LIMITER_OPTIONS": JSON.stringify(state.limiterOptions) });
        } else if (msg.type === 'setVisualizerFps') {
            state.visualizerFps = msg.fps;
            chrome.storage.local.set({ "VISUALIZER_FPS": msg.fps });
        } else if (msg.type === 'preset') {
            // Handle preset application
            if (msg.preset === 'bassBoost') {
                // Bass boost preset - update local state
                const bassBoostGains = [12, 10, 8, 4, 0, 0, 0, 0, 0, 0, 0];
                state.filters = z.map((f, i) => ({ f: f, g: bassBoostGains[i], q: H[i] }));
                state.gain = 1;
                const saveObj = { "GAIN": JSON.stringify(1) };
                for (let j = 0; j < K; j++) saveObj["filter" + j] = JSON.stringify(state.filters[j]);
                chrome.storage.local.set(saveObj);
            } else if (state.presets[msg.preset]) {
                // User preset - enrich message with preset data
                msg.presetData = state.presets[msg.preset];
                // Update local state
                const presetData = state.presets[msg.preset];
                state.filters = z.map((f, i) => ({
                    f: presetData.frequencies[i] || f,
                    g: presetData.gains[i] || 0,
                    q: presetData.qs[i] || H[i]
                }));
                state.gain = (presetData.gain !== undefined) ? presetData.gain : 1;
                const saveObj = { "GAIN": JSON.stringify(state.gain) };
                for (let j = 0; j < K; j++) saveObj["filter" + j] = JSON.stringify(state.filters[j]);
                chrome.storage.local.set(saveObj);
            }
        }

        ensureOffscreen().then(() => {
            chrome.runtime.sendMessage(msg);
        });

        // Send updated status to popup for immediate UI refresh
        if (['resetFilters', 'setQualityMode', 'preset', 'setSbrOptions', 'setLimiterOptions', 'setVisualizerFps'].includes(msg.type)) {
            sendFullStatus();
        }
        return;
    }

    if (msg.type === 'savePreset') {
        handleSavePreset(msg);
    } else if (msg.type === 'deletePreset') {
        handleDeletePreset(msg);
    } else if (msg.type === 'importPresets') {
        handleImportPresets(msg);
    } else if (msg.type === 'isTabStreaming') {
        // Check if a specific tab is already being EQ'd
        const isStreaming = state.activeStreams.includes(msg.tabId);
        sendResponse({ streaming: isStreaming });
        return true; // Keep channel open for async response
    } else if (msg.type === 'getFullRefresh' || msg.type === 'onPopupOpen') {
        ensureOffscreen().then(async () => {
            await initState();
            sendFullStatus();
            chrome.runtime.sendMessage(msg); // Forward wake up
        });
    }
});

initState();
