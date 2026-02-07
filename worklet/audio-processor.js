// AudioWorklet Processor for Ears Extension
// Handles real-time audio processing using Web Audio API
import init, { EarsDSP } from './ears_dsp.js';

class EarsAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.wasmModule = options?.processorOptions?.wasmModule;

        // Audio processing state
        this.filters = [];
        this.limiter = null;
        this.outputGain = 1.0;
        this.qualityMode = 'efficient';
        this.minReduction = 1.0;

        // FFT analysis initialization
        this.fftSize = 4096 * 2;
        this.fftBuffer = new Float32Array(this.fftSize);
        this.fftPosition = 0;
        this.fftCounter = 0;

        // SBR State
        this.sbrActive = false;
        this.sbrGain = 0.0;
        this.sbrHp1 = { x1: 0, y1: 0 };
        this.sbrHp2 = { x1: 0, y1: 0 };

        // Wasm State
        this.wasmDSP = null;
        this.wasmLoaded = false;
        this.wasmInputPtr = 0;
        this.wasmOutputPtr = 0;
        this.wasmMemory = null;

        // Filter configuration
        this.sampleRate = sampleRate;
        this.numFilters = 11;
        this.centerFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000];

        // Initialize filters
        this.initFilters();

        // Initialize FFT window (Hann)
        this.window = new Float32Array(this.fftSize);
        for (let i = 0; i < this.fftSize; i++) {
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.fftSize - 1)));
        }

        // Precompute bit reversal table
        this.bitRev = new Uint32Array(this.fftSize);
        let rev = 0;
        for (let i = 0; i < this.fftSize; i++) {
            this.bitRev[i] = rev;
            let mask = this.fftSize >> 1;
            while (rev & mask) {
                rev &= ~mask;
                mask >>= 1;
            }
            rev |= mask;
        }

        // Precompute twiddle factors
        this.sinTable = new Float32Array(this.fftSize / 2);
        this.cosTable = new Float32Array(this.fftSize / 2);
        for (let i = 0; i < this.fftSize / 2; i++) {
            this.sinTable[i] = Math.sin(-2 * Math.PI * i / this.fftSize);
            this.cosTable[i] = Math.cos(-2 * Math.PI * i / this.fftSize);
        }

        this.port.onmessage = (event) => this.handleMessage(event.data);

        // Start loading Wasm
        this.loadWasmModule();
    }

    async loadWasmModule() {
        try {
            console.log("Loading Wasm module...");
            const instance = await init({ module_or_path: this.wasmModule });
            this.wasmMemory = instance.memory;

            this.wasmDSP_L = new EarsDSP(this.sampleRate);
            this.wasmDSP_R = new EarsDSP(this.sampleRate);

            this.wasmLoaded = true;
            console.log('Wasm DSP loaded and initialized (Stereo)');

            this.syncWasmState();

        } catch (e) {
            console.error('Failed to load Wasm DSP:', e);
        }
    }

    syncWasmState() {
        if (!this.wasmLoaded) return;

        this.filters.forEach((f, i) => {
            let typeId = 1;
            if (f.type === 'lowshelf') typeId = 0;
            if (f.type === 'highshelf') typeId = 2;

            this.wasmDSP_L.set_filter(i, typeId, f.frequency, f.q, f.gain);
            this.wasmDSP_R.set_filter(i, typeId, f.frequency, f.q, f.gain);
        });

        this.wasmDSP_L.set_sbr_active(this.sbrActive);
        this.wasmDSP_R.set_sbr_active(this.sbrActive);

        this.wasmDSP_L.set_gain(this.outputGain);
        this.wasmDSP_R.set_gain(this.outputGain);

        let threshold = 0.89;
        if (this.qualityMode === 'quality') threshold = 0.94;
        if (this.qualityMode === 'hifi') threshold = 0.96;
        this.wasmDSP_L.set_limiter(threshold, 0.5);
        this.wasmDSP_R.set_limiter(threshold, 0.5);
    }

    processWasm(input, output, blockSize) {
        if (input[0] && output[0]) {
            this.wasmDSP_L.process_block(input[0], output[0]);
        }

        if (input[1] && output[1]) {
            this.wasmDSP_R.process_block(input[1], output[1]);
        }

        // FFT Analysis & SBR Detection (JS Side)
        if (output[0]) {
            // Accumulate samples for FFT (Sliding Window)
            const left = output[0];
            const right = output[1] || output[0];

            // Create temp array
            const blockData = new Float32Array(blockSize);
            for (let i = 0; i < blockSize; i++) {
                blockData[i] = (left[i] + right[i]) * 0.5;
            }

            // Shift buffer left and append new data
            this.fftBuffer.copyWithin(0, blockSize);
            this.fftBuffer.set(blockData, this.fftSize - blockSize);

            this.fftCounter++;
            if (this.fftCounter >= Math.floor(this.sampleRate / blockSize / 30)) {
                this.fftCounter = 0;

                // Use JS FFT
                const fftData = this.performFFT(this.fftBuffer);

                this.detectSBR(fftData);

                let reductionDb = 0;
                if (this.wasmLoaded) {
                    const l = this.wasmDSP_L.get_reduction_db();
                    const r = this.wasmDSP_R.get_reduction_db();
                    reductionDb = Math.min(l, r);

                    this.wasmDSP_L.set_sbr_active(this.sbrActive);
                    this.wasmDSP_R.set_sbr_active(this.sbrActive);
                }

                this.port.postMessage({
                    type: 'fftData',
                    data: fftData,
                    limiterReduction: reductionDb,
                    sbrActive: this.sbrActive
                });
            }
        }
        return true;
    }

    initFilters() {
        this.filters = this.centerFrequencies.map((freq, index) => ({
            type: index === 0 ? 'lowshelf' : (index === this.numFilters - 1 ? 'highshelf' : 'peaking'),
            frequency: freq,
            gain: 0,
            q: this.getQForFrequency(freq),
            b0: 1, b1: 0, b2: 0, a1: 0, a2: 0,
            x1L: 0, x2L: 0, y1L: 0, y2L: 0,
            x1R: 0, x2R: 0, y1R: 0, y2R: 0
        }));
        this.updateAllFilterCoefficients();
    }

    getQForFrequency(freq) {
        let q = 1.0;
        if (freq < 100) q = 0.7;
        else if (freq < 500) q = 0.9;
        else if (freq < 2000) q = 1.1;
        else if (freq < 8000) q = 1.3;
        else q = 1.5;

        if (this.qualityMode === 'efficient') return q * 0.8;
        else if (this.qualityMode === 'quality') return q * 1.0;
        else return q * 1.2;
    }

    updateAllFilterCoefficients() {
        this.filters.forEach(filter => this.calculateBiquadCoefficients(filter));
    }

    calculateBiquadCoefficients(filter) {
        const { type, frequency, gain, q } = filter;
        const w0 = 2 * Math.PI * frequency / this.sampleRate;
        const cosW0 = Math.cos(w0);
        const sinW0 = Math.sin(w0);
        const alpha = sinW0 / (2 * q);
        const A = Math.pow(10, gain / 40);
        let b0, b1, b2, a0, a1, a2;

        if (type === 'lowshelf') {
            b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
            b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
            b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
            a0 = (A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
            a1 = -2 * ((A - 1) + (A + 1) * cosW0);
            a2 = (A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
        } else if (type === 'highshelf') {
            b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
            b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
            b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
            a0 = (A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
            a1 = 2 * ((A - 1) - (A + 1) * cosW0);
            a2 = (A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
        } else {
            b0 = 1 + alpha * A; b1 = -2 * cosW0; b2 = 1 - alpha * A;
            a0 = 1 + alpha / A; a1 = -2 * cosW0; a2 = 1 - alpha / A;
        }
        filter.b0 = b0 / a0; filter.b1 = b1 / a0; filter.b2 = b2 / a0;
        filter.a1 = a1 / a0; filter.a2 = a2 / a0;
    }

    highpass(input, state, alpha) {
        const output = alpha * (state.y1 + input - state.x1);
        state.x1 = input; state.y1 = output;
        return output;
    }

    processSBR(sample, channelId) {
        let state = (channelId === 'L') ? this.sbrHp1 : this.sbrHp2;
        let hp1 = this.highpass(sample, state, 0.8);
        // Boosted SBR gain by +6dB (0.1 -> 0.2)
        return sample + (Math.abs(hp1) * this.sbrGain * 0.2);
    }

    detectSBR(magnitudes) {
        if (typeof this.sbrHoldTimer === 'undefined') this.sbrHoldTimer = 0;

        let midEnergy = 0, highEnergy = 0;
        // Check array bounds before accessing
        if (magnitudes.length < 2700) return;

        // Mid Band: 2kHz - 5kHz (Bin ~340 to ~850)
        for (let i = 340; i < 850; i++) midEnergy += magnitudes[i];

        // High Band: 6kHz - 16kHz (Bin ~1024 to ~2700)
        for (let i = 1024; i < 2700; i++) highEnergy += magnitudes[i];

        midEnergy /= (850 - 340);
        highEnergy /= (2700 - 1024);

        // Relaxes threshold to 0.5 (was 0.2) to account for dB scaling
        const conditionMet = (midEnergy > 0.05 && (highEnergy / midEnergy) < 0.5);

        if (conditionMet) {
            this.sbrHoldTimer = 5.0; // Hold for 5 seconds
            this.sbrActive = true;
        } else {
            if (this.sbrHoldTimer > 0) {
                this.sbrHoldTimer -= 0.035; // Approx 35ms per frame
                this.sbrActive = true;
            } else {
                this.sbrActive = false;
            }
        }

        if (this.sbrActive) {
            this.sbrGain += 0.05; // Faster attack
            if (this.sbrGain > 1.0) this.sbrGain = 1.0;
        } else {
            this.sbrGain -= 0.01; // Slower release
            if (this.sbrGain < 0.0) this.sbrGain = 0.0;
        }
    }

    processBiquad(filter, input, channel) {
        const isLeft = channel === 'L';
        const x1 = isLeft ? filter.x1L : filter.x1R;
        const x2 = isLeft ? filter.x2L : filter.x2R;
        const y1 = isLeft ? filter.y1L : filter.y1R;
        const y2 = isLeft ? filter.y2L : filter.y2R;

        const output = filter.b0 * input + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;

        if (isLeft) { filter.x2L = filter.x1L; filter.x1L = input; filter.y2L = filter.y1L; filter.y1L = output; }
        else { filter.x2R = filter.x1R; filter.x1R = input; filter.y2R = filter.y1R; filter.y1R = output; }
        return output;
    }

    softLimit(input, threshold) {
        const absInput = Math.abs(input);
        if (absInput < threshold) return input;
        const excess = absInput - threshold;
        const limited = threshold + excess / (1 + excess);
        const ratio = limited / absInput;
        if (ratio < this.minReduction) this.minReduction = ratio;
        return input > 0 ? limited : -limited;
    }

    handleMessage(data) {
        switch (data.type) {
            case 'modifyFilter':
                if (data.index >= 0 && data.index < this.numFilters) {
                    this.filters[data.index].frequency = data.frequency;
                    this.filters[data.index].gain = data.gain;
                    this.filters[data.index].q = data.q;
                    this.calculateBiquadCoefficients(this.filters[data.index]);

                    if (this.wasmLoaded) {
                        let f = this.filters[data.index];
                        let typeId = 1;
                        if (f.type === 'lowshelf') typeId = 0;
                        if (f.type === 'highshelf') typeId = 2;

                        this.wasmDSP_L.set_filter(data.index, typeId, f.frequency, f.q, f.gain);
                        this.wasmDSP_R.set_filter(data.index, typeId, f.frequency, f.q, f.gain);
                    }
                }
                break;
            case 'modifyGain':
                this.outputGain = data.gain;
                if (this.wasmLoaded) {
                    this.wasmDSP_L.set_gain(data.gain);
                    this.wasmDSP_R.set_gain(data.gain);
                }
                break;
            case 'resetFilters':
                this.filters.forEach((filter, i) => {
                    filter.gain = 0;
                    this.calculateBiquadCoefficients(filter);
                    if (this.wasmLoaded) {
                        this.wasmDSP_L.set_filter(i, 1, filter.frequency, filter.q, 0.0);
                        this.wasmDSP_R.set_filter(i, 1, filter.frequency, filter.q, 0.0);
                    }
                });
                this.outputGain = 1.0;
                break;
            case 'setQualityMode':
                this.qualityMode = data.mode;

                // Update Limiter
                let threshold = 0.89;
                if (this.qualityMode === 'quality') threshold = 0.94;
                if (this.qualityMode === 'hifi') threshold = 0.96;

                if (this.wasmLoaded) {
                    this.wasmDSP_L.set_limiter(threshold, 0.5);
                    this.wasmDSP_R.set_limiter(threshold, 0.5);
                }

                this.filters.forEach((filter, i) => {
                    filter.q = this.getQForFrequency(filter.frequency);
                    this.calculateBiquadCoefficients(filter);
                    if (this.wasmLoaded) {
                        let typeId = 1;
                        if (filter.type === 'lowshelf') typeId = 0;
                        if (filter.type === 'highshelf') typeId = 2;
                        this.wasmDSP_L.set_filter(i, typeId, filter.frequency, filter.q, filter.gain);
                        this.wasmDSP_R.set_filter(i, typeId, filter.frequency, filter.q, filter.gain);
                    }
                });
                break;
        }
    }

    performFFT(input) {
        const n = this.fftSize;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const val = input[i] * this.window[i];
            const rev = this.bitRev[i];
            real[rev] = val; imag[rev] = 0;
        }

        for (let size = 2; size <= n; size *= 2) {
            const halfSize = size / 2;
            const tabStep = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const k = j * tabStep;
                    const tReal = real[i + j + halfSize] * this.cosTable[k] - imag[i + j + halfSize] * this.sinTable[k];
                    const tImag = real[i + j + halfSize] * this.sinTable[k] + imag[i + j + halfSize] * this.cosTable[k];
                    real[i + j + halfSize] = real[i + j] - tReal; imag[i + j + halfSize] = imag[i + j] - tImag;
                    real[i + j] += tReal; imag[i + j] += tImag;
                }
            }
        }

        const magnitudes = new Float32Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
            let db = 20 * Math.log10(magnitudes[i] + 1e-6);
            magnitudes[i] = Math.max(0, (db + 100) / 100);
        }
        return magnitudes;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0]; const output = outputs[0];
        if (!input || input.length === 0) return true;

        const blockSize = input[0].length;

        // Use Wasm if loaded
        if (this.wasmLoaded) {
            return this.processWasm(input, output, blockSize);
        }

        const numChannels = Math.min(input.length, output.length);
        const threshold = this.qualityMode === 'efficient' ? 0.89 : this.qualityMode === 'quality' ? 0.94 : 0.96;

        // If Wasm not loaded, BYPASS DSP but keep Visualization
        for (let ch = 0; ch < numChannels; ch++) {
            output[ch].set(input[ch]);
        }

        for (let i = 0; i < blockSize; i++) {
            let sample = numChannels === 2 ? (output[0][i] + output[1][i]) * 0.5 : output[0][i];
            this.fftBuffer[this.fftPosition++] = sample;
            if (this.fftPosition >= this.fftSize) this.fftPosition = 0;
        }

        this.fftCounter++;
        if (this.fftCounter >= Math.floor(this.sampleRate / 128 / 30)) {
            this.fftCounter = 0;
            const fftData = this.performFFT(this.fftBuffer);
            this.detectSBR(fftData);

            let reductionDb = 0;
            if (this.minReduction < 1.0) reductionDb = 20 * Math.log10(Math.max(1e-6, this.minReduction));
            this.minReduction = 1.0;

            this.port.postMessage({
                type: 'fftData', data: fftData,
                limiterReduction: reductionDb,
                sbrActive: this.sbrGain > 0.1
            });
        }
        return true;
    }
}

registerProcessor('ears-audio-processor', EarsAudioProcessor);
