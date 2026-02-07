// Offscreen Document - Audio Processing with AudioWorklet
// Migrated from BiquadFilterNode to AudioWorklet for better performance

var M = null; // AudioContext
var Y = {};   // Active streams map
var Z = false; // Is Audio Initialized

// Quality mode settings
var qualityMode = 'efficient'; // 'efficient', 'quality', 'hifi'

const fftChannel = new BroadcastChannel('ears_fft');

// AudioWorklet node
var audioWorkletNode = null;

// Filter configuration
const K = 11;
const z = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000];

async function initAudio() {
    if (Z) return;

    M = new AudioContext({
        latencyHint: "playback",
        sampleRate: 48000
    });

    // Load AudioWorklet processor
    try {
        await M.audioWorklet.addModule(chrome.runtime.getURL('worklet/audio-processor.js'));
        console.log('AudioWorklet loaded successfully');
    } catch (err) {
        console.error('Failed to load AudioWorklet:', err);
        return;
    }

    // Create AudioWorklet node
    audioWorkletNode = new AudioWorkletNode(M, 'ears-audio-processor');

    // Handle messages from worklet
    audioWorkletNode.port.onmessage = (event) => {
        if (event.data.type === 'fftData') {
            // Forward FFT data to popup via BroadcastChannel
            fftChannel.postMessage({
                type: 'fft',
                fft: event.data.data
            });
        }
    };

    // Connect to destination
    audioWorkletNode.connect(M.destination);

    Z = true;
    console.log('Audio initialized with AudioWorklet');
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
        updateGain(1);
    }
}

initAudio();
