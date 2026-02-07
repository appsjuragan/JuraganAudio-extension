// AudioWorklet Processor for Ears Extension
// Handles real-time audio processing using Web Audio API

class EarsAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Audio processing state
        this.filters = [];
        this.limiter = null;
        this.outputGain = 1.0;
        this.qualityMode = 'efficient';

        // FFT analysis
        this.fftSize = 4096 * 2;
        this.fftBuffer = new Float32Array(this.fftSize);
        this.fftPosition = 0;
        this.fftCounter = 0;

        // Wasm State (Phase 3 Integration)
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

        // Message handler
        this.port.onmessage = (event) => this.handleMessage(event.data);
    }

    initFilters() {
        // Create biquad filter parameters for each band
        this.filters = this.centerFrequencies.map((freq, index) => ({
            type: index === 0 ? 'lowshelf' : (index === this.numFilters - 1 ? 'highshelf' : 'peaking'),
            frequency: freq,
            gain: 0,
            q: this.getQForFrequency(freq),
            // Biquad filter coefficients (will be calculated)
            b0: 1, b1: 0, b2: 0,
            a1: 0, a2: 0,
            // State variables
            x1: 0, x2: 0,
            y1: 0, y2: 0
        }));

        this.updateAllFilterCoefficients();
    }

    getQForFrequency(freq) {
        // Frequency-dependent Q values
        if (freq < 100) return 0.7;
        if (freq < 500) return 0.9;
        if (freq < 2000) return 1.1;
        if (freq < 8000) return 1.3;
        return 1.5;
    }

    updateAllFilterCoefficients() {
        this.filters.forEach(filter => {
            this.calculateBiquadCoefficients(filter);
        });
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
        } else { // peaking
            b0 = 1 + alpha * A;
            b1 = -2 * cosW0;
            b2 = 1 - alpha * A;
            a0 = 1 + alpha / A;
            a1 = -2 * cosW0;
            a2 = 1 - alpha / A;
        }

        // Normalize coefficients
        filter.b0 = b0 / a0;
        filter.b1 = b1 / a0;
        filter.b2 = b2 / a0;
        filter.a1 = a1 / a0;
        filter.a2 = a2 / a0;
    }

    processBiquad(filter, input) {
        // Direct Form II
        const output = filter.b0 * input + filter.b1 * filter.x1 + filter.b2 * filter.x2
            - filter.a1 * filter.y1 - filter.a2 * filter.y2;

        // Update state
        filter.x2 = filter.x1;
        filter.x1 = input;
        filter.y2 = filter.y1;
        filter.y1 = output;

        return output;
    }

    softLimit(input, threshold) {
        // Simple soft limiter
        const absInput = Math.abs(input);
        if (absInput < threshold) {
            return input;
        }

        const excess = absInput - threshold;
        const limited = threshold + excess / (1 + excess);
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
                }
                break;

            case 'modifyGain':
                this.outputGain = data.gain;
                break;

            case 'resetFilters':
                this.filters.forEach(filter => {
                    filter.gain = 0;
                    this.calculateBiquadCoefficients(filter);
                });
                this.outputGain = 1.0;
                break;

            case 'setQualityMode':
                this.qualityMode = data.mode;
                // Update Q values based on mode
                this.filters.forEach(filter => {
                    filter.q = this.getQForFrequency(filter.frequency);
                    this.calculateBiquadCoefficients(filter);
                });
                break;
        }
    }

    // Simple JS FFT (Cooley-Tukey)
    performFFT(input) {
        const n = this.fftSize;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);

        // Apply window and bit-reversal permutation
        for (let i = 0; i < n; i++) {
            const val = input[i] * this.window[i];
            const rev = this.bitRev[i];
            real[rev] = val;
            imag[rev] = 0;
        }

        // Butterfly operations
        for (let size = 2; size <= n; size *= 2) {
            const halfSize = size / 2;
            const tabStep = n / size;

            for (let i = 0; i < n; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const k = j * tabStep;
                    const tReal = real[i + j + halfSize] * this.cosTable[k] - imag[i + j + halfSize] * this.sinTable[k];
                    const tImag = real[i + j + halfSize] * this.sinTable[k] + imag[i + j + halfSize] * this.cosTable[k];

                    real[i + j + halfSize] = real[i + j] - tReal;
                    imag[i + j + halfSize] = imag[i + j] - tImag;
                    real[i + j] += tReal;
                    imag[i + j] += tImag;
                }
            }
        }

        // Compute magnitudes (0 to n/2)
        const magnitudes = new Float32Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
            // Convert to dB-like scale for visualization
            // 20 * log10(mag) + offset
            let db = 20 * Math.log10(magnitudes[i] + 1e-6);
            // Map -100dB to 0dB range to 0.0-1.0
            magnitudes[i] = Math.max(0, (db + 100) / 100);
        }

        return magnitudes;
    }

    // Phase 3: Wasm Integration Logic
    // This method will be called when Wasm module is loaded
    async loadWasmModule() {
        try {
            // Stub for loading the Wasm module
            // const { default: init, EarsDSP } = await import('../wasm/ears_dsp.js');
            // await init();
            // this.wasmDSP = new EarsDSP(this.sampleRate);

            // Allocate memory in Wasm linear memory for zero-copy/efficient transfer
            // this.wasmInputPtr = this.wasmDSP.alloc_buffer(128); // Block size
            // this.wasmOutputPtr = this.wasmDSP.alloc_buffer(128);

            // this.wasmLoaded = true;
            // console.log('Wasm DSP loaded successfully');
        } catch (e) {
            console.error('Wasm load failed, staying on JS fallback', e);
        }
    }

    processWasm(inputChannel, outputChannel, blockSize) {
        // Copy input to Wasm memory
        // const wasmInput = new Float32Array(this.wasmMemory.buffer, this.wasmInputPtr, blockSize);
        // wasmInput.set(inputChannel);

        // Process
        // this.wasmDSP.process_block(this.wasmInputPtr, this.wasmOutputPtr, blockSize);

        // Copy output from Wasm memory
        // const wasmOutput = new Float32Array(this.wasmMemory.buffer, this.wasmOutputPtr, blockSize);
        // outputChannel.set(wasmOutput);

        // FFT Handling
        // const fftData = this.wasmDSP.get_fft_data();
        // this.port.postMessage({ type: 'fftData', data: fftData });

        return true;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0]) {
            return true;
        }

        const inputChannel = input[0];
        const outputChannel = output[0];
        const blockSize = inputChannel.length;

        // Select Engine: Wasm (Priority) or JS (Fallback)
        if (this.wasmLoaded && this.wasmDSP) {
            return this.processWasm(inputChannel, outputChannel, blockSize);
        }

        // JS Fallback Processing
        // Process each sample
        for (let i = 0; i < blockSize; i++) {
            let sample = inputChannel[i];

            // Apply filter chain
            for (let f = 0; f < this.numFilters; f++) {
                sample = this.processBiquad(this.filters[f], sample);
            }

            // Apply output gain
            sample *= this.outputGain;

            // Soft limiting
            const threshold = this.qualityMode === 'efficient' ? 0.89 :
                this.qualityMode === 'quality' ? 0.94 : 0.96;
            sample = this.softLimit(sample, threshold);

            outputChannel[i] = sample;

            // Collect samples for FFT
            this.fftBuffer[this.fftPosition++] = sample;
            if (this.fftPosition >= this.fftSize) {
                this.fftPosition = 0;
            }
        }

        // Send FFT data periodically (30 FPS)
        this.fftCounter++;
        if (this.fftCounter >= Math.floor(this.sampleRate / 128 / 30)) {
            this.fftCounter = 0;

            // Perform JS FFT (fallback until Wasm is ready)
            // Use current buffer contents (with circular logic if needed, but buffer is large enough)
            // Ideally align starting position, but simple slice works for visualizer
            const fftData = this.performFFT(this.fftBuffer);

            this.port.postMessage({
                type: 'fftData',
                data: fftData
            });
        }

        return true;
    }
}

registerProcessor('ears-audio-processor', EarsAudioProcessor);
