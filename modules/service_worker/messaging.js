import { state, PRESETS_PREFIX, K } from './state.js';

export async function sendFullStatus() {
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
        qualityMode: state.qualityMode,
        sbrOptions: state.sbrOptions,
        limiterOptions: state.limiterOptions,
        visualizerFps: state.visualizerFps
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

export async function handleSavePreset(msg) {
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

export async function handleDeletePreset(msg) {
    await chrome.storage.sync.remove(PRESETS_PREFIX + msg.preset);
    delete state.presets[msg.preset];
    sendFullStatus();
}

export async function handleImportPresets(msg) {
    const presets = msg.presets;
    const saveObj = {};
    for (let key in presets) {
        saveObj[PRESETS_PREFIX + key] = presets[key];
        state.presets[key] = presets[key];
    }
    await chrome.storage.sync.set(saveObj);
    sendFullStatus();
}
