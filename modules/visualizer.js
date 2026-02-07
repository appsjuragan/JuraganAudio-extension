
const FFT_CHANNEL_NAME = 'juragan_audio_fft';
const VISUALIZER_KEY = "SHOW_VISUALIZER";

// Visualization constants (from wip-mv3)
const m = "wheat";
const q = "#2C3E50";
const E = 48000; // Sample Rate (updated to match AudioContext)
const T = 640; // Width
const B = 300; // Height

let fftChannel = null;
let limiterCallback = null;
let C = null; // Polyline element
let I = null; // Snap instance (will grab from global or re-init)

export function init(onLimiterUpdate) {
    limiterCallback = onLimiterUpdate;

    // Initialize Snap if needed - in main.js it seems I is global? 
    // But since we are modular, we need to access the SVG.
    // The SVG ID is 'eqSvg'
    if (typeof Snap !== 'undefined') {
        I = Snap("#eqSvg");
    }

    fftChannel = new BroadcastChannel(FFT_CHANNEL_NAME);
    fftChannel.onmessage = (event) => {
        if (event.data.type === 'fft') {
            updateVisualizer(event.data);
            if (event.data.limiterReduction !== undefined && limiterCallback) {
                limiterCallback(event.data.limiterReduction);
            }
        }
    };

    window.addEventListener('unload', () => {
        if (fftChannel) fftChannel.postMessage({ type: 'stopFFT' });
    });

    // Auto-start handled by main.js based on streaming status
    // if (isVisualizerOn()) {
    //     startOrStopVisualizer();
    // }

    return isVisualizerOn();
}

export function isVisualizerOn() {
    return localStorage[VISUALIZER_KEY] === "true";
}

export function toggleVisualizer() {
    const newState = !isVisualizerOn();
    localStorage[VISUALIZER_KEY] = newState ? "true" : "false";
    startOrStopVisualizer();
    return newState;
}

export function startOrStopVisualizer() {
    if (isVisualizerOn()) {
        if (fftChannel) fftChannel.postMessage({ type: 'startFFT' });
    } else {
        if (fftChannel) fftChannel.postMessage({ type: 'stopFFT' });
        // Clear visualization
        if (C) {
            C.remove();
            C = null;
        }
    }
}

// Helper functions from wip-mv3
function P(e) {
    // Freq to X
    // P(e) = te(e/c) * T where c=22050 (Nyquist)
    // te(e) = e^(1/4)
    const c = 22050; // Nyquist
    let val = e / c;
    if (val < 0) val = 0;
    return Math.pow(val, 0.25) * T;
}

export function updateVisualizer(data) {
    if (!isVisualizerOn()) return;

    const n = data.fft || data.data;
    if (!n || n.length === 0) return;

    // Ensure we have Snap instance
    if (!I) {
        if (typeof Snap !== 'undefined') I = Snap("#eqSvg");
        if (!I) return;
    }

    // Remove old polyline
    if (C) {
        C.remove();
        C = null;
    }

    const isLight = document.body.classList.contains("light-mode");
    const topColor = isLight ? "#4f46e5" : "#22d3ee";
    const midColor = "#818cf8";
    const bottomColor = isLight ? "rgba(79, 70, 229, 0.1)" : "rgba(255, 255, 255, 0.1)";

    const strokeGradient = I.gradient(`L(0, 0, 0, ${B})${topColor}-${midColor}-${bottomColor}`).attr({
        gradientUnits: "userSpaceOnUse"
    });

    var r = [];

    // Helper map Y (0 to B)
    // dB -100 -> B (bottom)
    // dB 0 -> 0 (top)
    // Actually original Logic:
    // var c = ((n[i] + 100) / 100) * B;
    // n[i] is dB? If so -100+100=0 -> 0?
    // Wait, c is height from bottom?
    // Svg coords: 0 is top, B is bottom.
    // Original code used `a(e) { return B - 1 - e; }` to flip Y.

    function a(e) {
        return B - 1 - e;
    }

    // Process data points
    // n.length is usually fftSize/2 (e.g. 4096)
    // Iterate and map to X, Y

    for (let i = 0; i < n.length; i++) {
        // Frequency for bin i
        // freq = i * SampleRate / (fftSize)
        // But we don't have fftSize here, we have n.length which is half fftSize
        // So i * SampleRate / (n.length * 2)

        var o = (i * E) / (n.length * 2); // Frequency

        if (o < 10) continue; // Skip very low freq

        var s = P(o); // X position
        if (s > T) break; // Off screen

        // Y position
        // n[i] is dB, typically -100 to 0
        // Normalize to 0..B range
        // c = value from 0 to B
        var db = n[i];

        // Clamp db -100 to 0 implicitly by the math or explicit
        if (db < -100) db = -100;
        if (db > 0) db = 0;

        var c = ((db + 100) / 100) * B;
        // example: 0dB -> 100/100 * B = B (Full height bar)
        // example: -100dB -> 0/100 * B = 0

        r.push([s, c]);
    }

    // Smooth/Decimate points (simple algorithm from original)
    var u = [];
    for (let i = 0; i < r.length; i++) {
        var l = r[i];
        if (u.length == 0) {
            u.push(l);
            continue;
        }
        var last = u[u.length - 1];
        var v = 2; // pixel threshold

        // If x difference is small, take max y
        if (l[0] - last[0] < v) {
            if (l[1] > last[1]) {
                last[1] = l[1];
            }
        } else {
            u.push(l);
        }
    }

    // Convert to flat array for polyline [x1, y1, x2, y2...]
    // And remember to flip Y using a() because SVG 0 is top
    // c was amplitude (0 to B), so a(c) converts to SVG Y
    var d = [];
    for (let i = 0; i < u.length; i++) {
        var f = u[i];
        d.push(f[0]);
        d.push(a(f[1]));
    }

    // Draw
    C = I.polyline(d).attr({
        "fill-opacity": "0",
        stroke: strokeGradient,
        "pointer-events": "none",
        "stroke-width": 2
    });
}
