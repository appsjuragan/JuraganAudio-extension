// Service Worker for Ears Audio Toolkit (Manifest V3)

// State management
let state = {
    gain: 1,
    filters: [],
    presets: {},
    activeStreams: [] // Tab IDs
};

const PRESETS_PREFIX = "PRESETS.";
const K = 11;
const z = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
const H = [0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071];

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
            filters: state.filters
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
        'preset'
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
        }

        ensureOffscreen().then(() => {
            chrome.runtime.sendMessage(msg);
        });

        // Send updated status to popup for immediate UI refresh
        if (msg.type === 'modifyFilter' || msg.type === 'modifyGain' || msg.type === 'resetFilters') {
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
        gain: state.gain
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
        qs: state.filters.map(f => f.q)
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
