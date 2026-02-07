// Offscreen Document - Audio Processing with AudioWorklet
// Migrated from BiquadFilterNode to AudioWorklet for better performance

var M = null; // AudioContext
var Y = {};   // Active streams map
var Z = false; // Is Audio Initialized

// Quality mode settings
var qualityMode = 'efficient'; // 'efficient', 'quality', 'hifi'

const fftChannel = new BroadcastChannel('juragan_audio_fft');

// AudioWorklet node
var audioWorkletNode = null;

// AnalyserNode for spectrum visualization (provides proper dB data)
var analyserNode = null;
var fftLoopRunning = false;
var currentLimiterReduction = 0;

// Filter configuration
const K = 11;
const z = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000];

async function initAudio() {

    // Attempt to get our own tab ID if possible
    try {
        if (chrome.tabs && chrome.tabs.getCurrent) {
            chrome.tabs.getCurrent(tab => { });
        }
    } catch (e) { }

    if (Z) return;

    M = new AudioContext({
        latencyHint: "playback",
        sampleRate: 48000
    });

    // Load AudioWorklet processor
    try {
        await M.audioWorklet.addModule(chrome.runtime.getURL('worklet/audio-processor.js'));
    } catch (err) {
        console.error('Failed to load AudioWorklet:', err);
        return;
    }

    // Load and compile Wasm module
    const response = await fetch(chrome.runtime.getURL('worklet/juragan_audio_dsp_bg.wasm'));
    const bytes = await response.arrayBuffer();
    const wasmModule = await WebAssembly.compile(bytes);

    // Create AudioWorklet node
    audioWorkletNode = new AudioWorkletNode(M, 'juragan-audio-processor', {
        processorOptions: {
            wasmModule: wasmModule
        }
    });

    // Handle messages from worklet (FFT data, limiter, SBR)
    // Handle messages from worklet (FFT data, limiter, SBR)
    audioWorkletNode.port.onmessage = (event) => {
        if (event.data.type === 'fftData') {
            const data = event.data;
            currentLimiterReduction = data.limiterReduction;

            // Forward to popup/background
            chrome.runtime.sendMessage({
                type: 'fftData',
                data: data.data,
                limiterReduction: data.limiterReduction,
                sbrActive: data.sbrActive
            }).catch(() => { }); // Ignore errors if popup is closed
        }
    };

    // Connect worklet to destination
    audioWorkletNode.connect(M.destination);

    // Create AnalyserNode for visualization (provides proper dB data like wip-mv3)
    analyserNode = M.createAnalyser();
    analyserNode.fftSize = 4096 * 2;
    analyserNode.smoothingTimeConstant = 0.75;
    // Connect worklet output to analyser for visualization
    audioWorkletNode.connect(analyserNode);

    Z = true;
}

function updateFilter(msg) {
    if (!audioWorkletNode) return;

    audioWorkletNode.port.postMessage({
        type: 'modifyFilter',
        index: msg.index,
        frequency: msg.frequency,
        gain: msg.gain,
        q: msg.q
    });
}

function updateGain(val) {
    if (!audioWorkletNode) return;

    audioWorkletNode.port.postMessage({
        type: 'modifyGain',
        gain: val
    });
}

function setQualityMode(mode) {
    qualityMode = mode;

    if (!audioWorkletNode) return;

    audioWorkletNode.port.postMessage({
        type: 'setQualityMode',
        mode: mode
    });

    chrome.runtime.sendMessage({ type: "qualityModeChanged", mode: mode }).catch(() => { });
}

async function addStream(stream, tabId) {
    if (!M) await initAudio();

    if (M.state === 'suspended') {
        await M.resume();
    }

    if (Y[tabId]) {
        removeStream(tabId);
    }

    const source = M.createMediaStreamSource(stream);
    source.connect(audioWorkletNode);

    Y[tabId] = {
        stream: stream,
        source: source
    };

    chrome.runtime.sendMessage({ type: "streamStarted", tabId: tabId });

    const tracks = stream.getAudioTracks();
    if (tracks.length > 0) {
        tracks[0].onended = () => {
            removeStream(tabId);
        };
    }
}

function removeStream(tabId) {
    if (Y[tabId]) {
        const streamInfo = Y[tabId];
        delete Y[tabId];

        try {
            streamInfo.stream.getTracks().forEach(t => t.stop());
            streamInfo.source.disconnect();
        } catch (e) {
            console.error("Error stopping stream:", e);
        }

        chrome.runtime.sendMessage({ type: "streamEnded", tabId: tabId });
    }
    if (Object.keys(Y).length == 0) M.suspend();
}

// Message Listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case "initialState":
            if (msg.qualityMode) setQualityMode(msg.qualityMode);
            for (let j = 0; j < K; j++) {
                if (msg.filters[j]) {
                    updateFilter({ index: j, frequency: msg.filters[j].f, gain: msg.filters[j].g, q: msg.filters[j].q });
                }
            }
            if (msg.gain) updateGain(msg.gain);
            break;
        case "eqTab":
            if (msg.streamId) {
                // Check if we already have a stream for this tab
                if (Y[msg.tabId]) {
                    console.log("Tab already has active stream, skipping capture");
                    break;
                }
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
                }).catch(err => {
                    // console.error("Error capturing tab:", err.message);
                    // Notify service worker about the error but suppress console noise
                    chrome.runtime.sendMessage({ type: "captureError", tabId: msg.tabId, error: err.message });
                });
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
            if (audioWorkletNode) {
                audioWorkletNode.port.postMessage({ type: 'resetFilters' });
            }
            break;
        case "resetFilter":
            updateFilter({ index: msg.index, gain: 0, frequency: z[msg.index], q: 1.0 });
            break;
        case "setQualityMode":
            setQualityMode(msg.mode);
            break;
        case "getQualityMode":
            sendResponse({ mode: qualityMode, limiterReduction: 0 });
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
        for (let j = 0; j < K; j++) {
            updateFilter({
                index: j,
                gain: BASS_BOOST_PRESET.gains[j],
                frequency: z[j],
                q: 1.0
            });
        }
        updateGain(1);
    } else if (presetData) {
        for (let j = 0; j < K; j++) {
            updateFilter({
                index: j,
                gain: presetData.gains[j] || 0,
                frequency: presetData.frequencies[j] || z[j],
                q: presetData.qs[j] || 1.0
            });
        }
        updateGain((presetData.gain !== undefined) ? presetData.gain : 1);
    }
}

// FFT loop using AnalyserNode (like wip-mv3 branch)
function fftLoop() {
    if (!fftLoopRunning) return;

    if (analyserNode) {
        var array = new Float32Array(analyserNode.frequencyBinCount);
        analyserNode.getFloatFrequencyData(array); // Returns dB values (-Infinity to 0)

        const fftData = Array.from(array).map(v => {
            if (!isFinite(v) || v < -100) return -100;
            if (v > 0) return 0;
            return v;
        });

        fftChannel.postMessage({
            type: 'fft',
            fft: fftData,
            limiterReduction: currentLimiterReduction
        });
    }

    setTimeout(fftLoop, 1000 / 30); // 30 FPS for visualizer
}

// Listen for FFT start/stop requests from popup
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
