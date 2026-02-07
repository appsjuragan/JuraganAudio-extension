
// Constants
export const WIDTH = 600;      // T
export const HEIGHT = 360;     // B
export const GAIN_WIDTH = 30;  // g
export const MAX_FREQ = 22050; // c
export const MAX_GAIN = 30;    // u
export const GAIN_RANGE = 30;  // M (y limit for drag?)
export const MIN_GAIN = -30;   // k

let sampleRate = 44100; // E

export function setSampleRate(rate) {
    sampleRate = rate;
}

export function getSampleRate() {
    return sampleRate;
}

export function xToFreq(x) { // l(e)
    return Math.pow(x / WIDTH, 4) * MAX_FREQ;
}

export function freqToX(freq) { // P(e)
    // Protect against NaN
    if (typeof freq !== 'number' || isNaN(freq) || freq <= 0) freq = 1000;
    return Math.pow(freq / MAX_FREQ, 1 / 4) * WIDTH;
}

export function gainToY(gain) { // F(e)
    // Protect against NaN
    if (typeof gain !== 'number' || isNaN(gain)) gain = 0;
    const range = MAX_GAIN - MIN_GAIN;
    return HEIGHT * (1 - (gain - MIN_GAIN) / range);
}

export function yToGain(y) { // f(e)
    const range = MAX_GAIN - MIN_GAIN;
    return (1 - y / HEIGHT) * range + MIN_GAIN;
}

export function clamp(val, min, max) { // ne(e, t, n)
    if (val < min) return min;
    if (val > max) return max;
    return val;
}

export function dbToGain(db) { // le(e)
    return Math.pow(10, db / 10); // Actually this looks like db/10 for power? 通常 is db/20 for amplitude but here it is consistent with existing code
}

export function gainToDb(gain) { // fe(e)
    // Protect against NaN/Infinity
    if (!gain || gain <= 0) return 0;
    return 10 * Math.log10(gain);
} // note: this seems to treat 'gain' as power ratio if 10*log10.  Usually gain factor is 20*log10. 
// Code says: return Math.pow(10, e / 10); so consistent.

export function limitQ(q) { // ie(e)
    if (q < 0.2) return 0.2;
    if (q > 11) return 11;
    return q;
}

// Helper for power of 4
function pow4(x) { return Math.pow(x, 4); }
