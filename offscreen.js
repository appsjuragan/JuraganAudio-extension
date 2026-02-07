// offscreen.js - Pure Audio Processor (MV3) with Sound Quality Enhancements

// Global variables (No chrome.storage or chrome.tabs here!)
var M = null; // AudioContext
var B = null; // Source Gain
var G = null; // Output Gain
var L = null; // Limiter (DynamicsCompressor)
var Q = null; // Analyser
var V = [];   // Filters
var K = 11;
var Y = {};   // Active streams map
var Z = false; // Is Audio Initialized

// Quality mode settings
var qualityMode = 'efficient'; // 'efficient', 'quality', 'hifi'

const fftChannel = new BroadcastChannel('ears_fft');

// Optimized frequency-dependent Q values for better sound quality
var z = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
// Q values: wider for bass, tighter for mids/highs, gentle for shelves
var H_EFFICIENT = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 0.5];
var H_QUALITY = [0.45, 0.5, 0.55, 0.65, 0.75, 0.85, 1.1, 1.4, 1.8, 2.0, 0.45];
var H = H_EFFICIENT; // Default to efficient mode Q values

function initAudio() {
    if (Z) return;
    Z = true;

    // Force consistent 48kHz sample rate for quality
    M = new AudioContext({
        latencyHint: "playback",
        sampleRate: 48000
    });
    M.suspend();

    B = M.createGain();
    B.gain.value = 1;
    G = M.createGain();
    G.gain.value = 1;

    // Create soft limiter to prevent clipping distortion
    L = M.createDynamicsCompressor();
    L.threshold.value = -1;      // Start limiting at -1dB
    L.knee.value = 6;            // 6dB soft knee for smooth limiting
    L.ratio.value = 20;          // Near-brick-wall limiting
    L.attack.value = 0.001;      // 1ms attack - fast enough to catch peaks
    L.release.value = 0.1;       // 100ms release - smooth recovery

    V = [];
    var prevNode = B;
    for (var j = 0; j < K; j++) {
        var filter = M.createBiquadFilter();
        if (j == 0) filter.type = "lowshelf";
        else if (j == K - 1) filter.type = "highshelf";
        else filter.type = "peaking";

        filter.frequency.value = z[j];
        filter.gain.value = 0;
        filter.Q.value = H[j];

        prevNode.connect(filter);
        prevNode = filter;
        V.push(filter);
    }

    // Connect: Filters -> Output Gain -> Limiter -> Destination
    prevNode.connect(G);
    G.connect(L);
    L.connect(M.destination);

    // Keep alive
    setInterval(() => {
        chrome.runtime.sendMessage({ type: "keepAlive" }).catch(() => { });
    }, 20000);
}

function updateFilter(e) {
    if (!V[e.index]) return;
    var f = V[e.index];
    f.gain.value = e.gain;
    f.frequency.value = e.frequency;
    f.Q.value = e.q;
}

function updateGain(val) {
    if (G) G.gain.value = val;
}

// Set quality mode (without dithering to avoid artifacts)
function setQualityMode(mode) {
    qualityMode = mode;

    switch (mode) {
        case 'efficient':
            H = H_EFFICIENT;
            if (L) {
                L.threshold.value = -1;
                L.knee.value = 6;
                L.ratio.value = 20;
            }
            break;
        case 'quality':
            H = H_QUALITY;
            if (L) {
                L.threshold.value = -0.5;  // Tighter limiting
                L.knee.value = 4;          // Softer knee
                L.ratio.value = 20;
            }
            break;
        case 'hifi':
            H = H_QUALITY;
            if (L) {
                L.threshold.value = -0.3;  // Even tighter
                L.knee.value = 3;
                L.ratio.value = 20;
            }
            break;
    }

    // Update existing filter Q values
    for (let j = 0; j < V.length; j++) {
        if (V[j]) {
            V[j].Q.value = H[j];
        }
    }

    // Notify about mode change
    chrome.runtime.sendMessage({ type: "qualityModeChanged", mode: mode }).catch(() => { });
}

// Get current limiter gain reduction for metering
function getLimiterReduction() {
    return L ? L.reduction : 0;
}

function addStream(stream, tabId) {
    if (Y[tabId]) {
        Y[tabId].stream.getTracks().forEach(t => t.stop());
    }

    if (Object.keys(Y).length == 0) M.resume();

    var source = M.createMediaStreamSource(stream);
    source.connect(B);

    Y[tabId] = { stream: stream, source: source };

    // Notify SW we started
    chrome.runtime.sendMessage({ type: "streamStarted", tabId: tabId });

    // Handle stream ending
    const tracks = stream.getAudioTracks();
    if (tracks.length > 0) {
        tracks[0].onended = () => {
            removeStream(tabId);
        };
    }
}

function removeStream(tabId) {
    if (Y[tabId]) {
        Y[tabId].stream.getTracks().forEach(t => t.stop());
        Y[tabId].source.disconnect();
        delete Y[tabId];
        chrome.runtime.sendMessage({ type: "streamEnded", tabId: tabId });
    }
    if (Object.keys(Y).length == 0) M.suspend();
}

// Message Listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case "initialState":
            G.gain.value = msg.gain;
            if (msg.qualityMode) setQualityMode(msg.qualityMode);
            for (let j = 0; j < K; j++) {
                if (msg.filters[j]) {
                    updateFilter({ index: j, frequency: msg.filters[j].f, gain: msg.filters[j].g, q: msg.filters[j].q });
                }
            }
            break;
        case "eqTab":
            if (msg.streamId) {
                navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'tab',
                            chromeMediaSourceId: msg.streamId
                        }
                    },
                    video: false
                }).then(stream => {
                    addStream(stream, msg.tabId);
                }).catch(err => console.error(err));
            } else if (msg.on === false) {
                if (msg.tabId) removeStream(msg.tabId);
            }
            break;
        case "modifyFilter":
            updateFilter(msg);
            break;
        case "modifyGain":
            updateGain(msg.gain);
            break;
        case "resetFilters":
            for (let j = 0; j < K; j++) {
                updateFilter({ index: j, gain: 0, frequency: z[j], q: H[j] });
            }
            updateGain(1);
            break;
        case "resetFilter":
            updateFilter({ index: msg.index, gain: 0, frequency: z[msg.index], q: H[msg.index] });
            break;
        case "setQualityMode":
            setQualityMode(msg.mode);
            break;
        case "getQualityMode":
            sendResponse({ mode: qualityMode, limiterReduction: getLimiterReduction() });
            return true;
        case "preset":
            applyPreset(msg.preset, msg.presetData);
            break;
    }
});

// Bass boost preset values
const BASS_BOOST_PRESET = {
    gains: [12, 10, 8, 4, 0, 0, 0, 0, 0, 0, 0]
};

function applyPreset(presetName, presetData) {
    if (presetName === "bassBoost") {
        // Apply bass boost preset
        for (let j = 0; j < K; j++) {
            updateFilter({
                index: j,
                gain: BASS_BOOST_PRESET.gains[j],
                frequency: z[j],
                q: H[j]
            });
        }
        updateGain(1);
    } else if (presetData) {
        // Apply user preset
        for (let j = 0; j < K; j++) {
            updateFilter({
                index: j,
                gain: presetData.gains[j] || 0,
                frequency: presetData.frequencies[j] || z[j],
                q: presetData.qs[j] || H[j]
            });
        }
        updateGain(1);
    }
}

let fftLoopRunning = false;
function fftLoop() {
    if (!fftLoopRunning) return;
    if (Q) {
        var array = new Float32Array(Q.frequencyBinCount);
        Q.getFloatFrequencyData(array);
        // Include limiter reduction in FFT data for UI metering
        fftChannel.postMessage({
            type: "fft",
            fft: Array.from(array),
            limiterReduction: getLimiterReduction()
        });
    } else {
        if (M) {
            Q = M.createAnalyser();
            Q.fftSize = 4096 * 2;
            // Smoother visualization (was 0.5)
            Q.smoothingTimeConstant = 0.75;
            // Connect analyser after limiter for accurate metering
            L.connect(Q);
        }
    }
    setTimeout(fftLoop, 1000 / 30); // 30 FPS for visualizer
}

fftChannel.onmessage = (event) => {
    if (event.data.type === 'startFFT') {
        if (!fftLoopRunning) {
            fftLoopRunning = true;
            fftLoop();
        }
    } else if (event.data.type === 'stopFFT') {
        fftLoopRunning = false;
    }
};

initAudio();
