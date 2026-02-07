// Service Worker for JuraganAudio Toolkit (Manifest V3) with Quality Modes

// State management
let state = {
    gain: 1,
    filters: [],
    presets: {},
    activeStreams: [], // Tab IDs
    qualityMode: 'efficient' // 'efficient', 'quality', 'hifi'
};

const PRESETS_PREFIX = "PRESETS.";
const K = 11;
const z = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
// Updated Q values - frequency dependent for better sound
const H_EFFICIENT = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 0.5];
const H = H_EFFICIENT;

// Initialize state from storage
async function initState() {
    const data = await chrome.storage.local.get(null);
    state.gain = data.GAIN ? JSON.parse(data.GAIN) : 1;

    state.filters = [];
    for (let j = 0; j < K; j++) {
        const key = "filter" + j;
        if (data[key]) {
            state.filters.push(JSON.parse(data[key]));
        } else {
            state.filters.push({ f: z[j], g: 0, q: H[j] });
        }
    }

    // Load quality mode setting
    state.qualityMode = data.QUALITY_MODE || 'efficient';

    const syncData = await chrome.storage.sync.get(null);
    state.presets = {};
    for (let key in syncData) {
        if (key.startsWith(PRESETS_PREFIX)) {
            state.presets[key.slice(PRESETS_PREFIX.length)] = syncData[key];
        }
    }
}

// Create offscreen document for audio processing
let creating; // A global promise to avoid concurrency issues
async function ensureOffscreen() {
    const path = 'offscreen.html';
    if (await chrome.offscreen.hasDocument()) return;

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Audio equalization requires AudioContext and tabCapture',
        });
        await creating;
        creating = null;

        // Sync state immediately after creation
        chrome.runtime.sendMessage({
            type: "initialState",
            gain: state.gain,
            filters: state.filters,
            qualityMode: state.qualityMode
        });
    }
}

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
        'setQualityMode'
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
        if (msg.type === 'resetFilters' || msg.type === 'setQualityMode' || msg.type === 'preset') {
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

async function sendFullStatus() {
    const tabs = await chrome.tabs.query({});
    const activeStreamTabs = tabs.filter(t => state.activeStreams.includes(t.id));

    // Send to popup
    const filters = state.filters.map((f, i) => ({
        frequency: f.f,
        gain: f.g,
        type: (i === 0) ? "lowshelf" : (i === K - 1) ? "highshelf" : "peaking",
        q: f.q
    }));
    chrome.runtime.sendMessage({
        type: "sendWorkspaceStatus",
        eqFilters: filters,
        streams: activeStreamTabs,
        gain: state.gain,
        qualityMode: state.qualityMode
    });

    // Also current tab status
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length) {
        chrome.runtime.sendMessage({
            type: "sendCurrentTabStatus",
            streaming: state.activeStreams.includes(activeTabs[0].id)
        });
    }

    // Presets
    chrome.runtime.sendMessage({ type: "sendPresets", presets: state.presets });
}

async function handleSavePreset(msg) {
    const presetData = {
        frequencies: state.filters.map(f => f.f),
        gains: state.filters.map(f => f.g),
        qs: state.filters.map(f => f.q),
        gain: state.gain // Save master gain
    };

    const saveObj = {};
    saveObj[PRESETS_PREFIX + msg.preset] = presetData;
    await chrome.storage.sync.set(saveObj);
    state.presets[msg.preset] = presetData;
    sendFullStatus();
}

async function handleDeletePreset(msg) {
    await chrome.storage.sync.remove(PRESETS_PREFIX + msg.preset);
    delete state.presets[msg.preset];
    sendFullStatus();
}

async function handleImportPresets(msg) {
    const presets = msg.presets;
    const saveObj = {};
    for (let key in presets) {
        saveObj[PRESETS_PREFIX + key] = presets[key];
        state.presets[key] = presets[key];
    }
    await chrome.storage.sync.set(saveObj);
    sendFullStatus();
}

initState();
