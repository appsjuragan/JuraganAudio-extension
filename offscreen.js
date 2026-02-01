// offscreen.js - Pure Audio Processor (MV3)

// Global variables (No chrome.storage or chrome.tabs here!)
var M = null; // AudioContext
var B = null; // Source Gain
var G = null; // Output Gain
var Q = null; // Analyser
var V = [];   // Filters
var K = 11;
var Y = {};   // Active streams map
var Z = false; // Is Audio Initialized

const fftChannel = new BroadcastChannel('ears_fft');

var z = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
var H = [0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071, 0.7071];

function initAudio() {
    if (Z) return;
    Z = true;

    M = new AudioContext({ latencyHint: "playback" });
    M.suspend();

    B = M.createGain();
    B.gain.value = 1;
    G = M.createGain();
    G.gain.value = 1;

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
    prevNode.connect(G);
    G.connect(M.destination);

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
                // We need tabId. SW should have passed it if eqTab came from popup
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
    }
});

let fftLoopRunning = false;
function fftLoop() {
    if (!fftLoopRunning) return;
    if (Q) {
        var array = new Float32Array(Q.frequencyBinCount);
        Q.getFloatFrequencyData(array);
        fftChannel.postMessage({ type: "fft", fft: Array.from(array) });
    } else {
        if (M) {
            Q = M.createAnalyser();
            Q.fftSize = 4096 * 2;
            Q.smoothingTimeConstant = 0.5;
            G.connect(Q);
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
