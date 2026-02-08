export const K = 11;
export const z = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
// Updated Q values - frequency dependent for better sound
export const H_EFFICIENT = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 0.5];
export const H = H_EFFICIENT;

export const PRESETS_PREFIX = "PRESETS.";

export let state = {
    gain: 1,
    filters: [],
    presets: {},
    activeStreams: [], // Tab IDs
    qualityMode: 'efficient', // 'efficient', 'quality', 'hifi'
    sbrOptions: { enabled: false, gain: 1.0 },
    limiterOptions: { enabled: true, attack: 0.1 }, // attack in seconds (100ms)
    visualizerFps: 30
};

export async function initState() {
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

    // Load new settings
    // Load new settings
    if (data.SBR_OPTIONS) {
        state.sbrOptions = JSON.parse(data.SBR_OPTIONS);
    } else {
        state.sbrOptions = { enabled: false, gain: 1.0 };
    }

    if (data.LIMITER_OPTIONS) {
        state.limiterOptions = JSON.parse(data.LIMITER_OPTIONS);
    } else {
        state.limiterOptions = { enabled: true, attack: 0.1 };
    }

    if (data.VISUALIZER_FPS) {
        state.visualizerFps = parseInt(data.VISUALIZER_FPS) || 30;
    } else {
        state.visualizerFps = 30;
    }

    const syncData = await chrome.storage.sync.get(null);
    state.presets = {};

    // Default Presets
    const defaults = {
        "Bass Boost": {
            frequencies: z,
            gains: [8, 6.5, 5, 3, 1, 0, 0, 0, 0, 0, 0],
            qs: H,
            gain: 1
        },
        "Treble": {
            frequencies: z,
            gains: [0, 0, 0, 0, 0, 0, 1, 3, 5, 7, 8],
            qs: H,
            gain: 1
        },
        "Loudness": {
            frequencies: z,
            gains: [6, 4, 3, 0, -1, -2, -1, 0, 3, 5, 7],
            qs: H,
            gain: 1
        }
    };

    // Load saved presets first
    for (let key in syncData) {
        if (key.startsWith(PRESETS_PREFIX)) {
            state.presets[key.slice(PRESETS_PREFIX.length)] = syncData[key];
        }
    }

    // Merge defaults (only if not already present to allow overrides? Or just force add them?)
    // If I want them to be "factory presets" that persist, I should add them if not present.
    // But if user deletes "Bass Boost", it will come back. That's usually fine for "Defaults".
    for (let key in defaults) {
        if (!state.presets[key]) {
            state.presets[key] = defaults[key];
        }
    }
}
