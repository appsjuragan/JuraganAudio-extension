// Handles real-time audio processing using Web Audio API

import './polyfill.js';
import init, { JuraganAudioDSP } from './juragan_audio_dsp.js';
import { JuraganAudioFilters } from './modules/filters.js';
import { JuraganAudioFFT } from './modules/fft.js';
import { JuraganAudioDynamics } from './modules/dynamics.js';
import { JuraganAudioSBR } from './modules/sbr.js';

class JuraganAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.wasmModule = options?.processorOptions?.wasmModule;

        // Settings / User Options
        this.outputGain = 1.0;
        this.visualizerFps = 30;
        this.framesPerRender = sampleRate / 30;
        this.samplesSinceLastFft = 0;

        // Modules
        // Filters
        this.numFilters = 11;
        this.centerFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000];
        this.filters = new JuraganAudioFilters(sampleRate, this.numFilters, this.centerFrequencies);

        // Dynamics (Limiter/Compressor)
        this.dynamics = new JuraganAudioDynamics(sampleRate);

        // SBR
        this.sbr = new JuraganAudioSBR();

        // FFT
        this.fftSize = 4096 * 2;
        this.fft = new JuraganAudioFFT(this.fftSize);

        // Wasm State
        this.wasmDSP_L = null;
        this.wasmDSP_R = null;
        this.wasmLoaded = false;
        this.wasmMemory = null;

        this.port.onmessage = (event) => this.handleMessage(event.data);

        // Start loading Wasm
        this.loadWasmModule();
    }

    async loadWasmModule() {
        try {
            const instance = await init({ module_or_path: this.wasmModule });
            this.wasmMemory = instance.memory;

            this.wasmDSP_L = new JuraganAudioDSP(sampleRate);
            this.wasmDSP_R = new JuraganAudioDSP(sampleRate);

            this.wasmLoaded = true;

            this.syncWasmState();

        } catch (e) {
            console.error('Failed to load Wasm DSP:', e);
        }
    }

    syncWasmState() {
        if (!this.wasmLoaded) return;

        const filterList = this.filters.filters;
        filterList.forEach((f, i) => {
            let typeId = 1;
            if (f.type === 'lowshelf') typeId = 0;
            if (f.type === 'highshelf') typeId = 2;

            this.wasmDSP_L.set_filter(i, typeId, f.frequency, f.q, f.gain);
            this.wasmDSP_R.set_filter(i, typeId, f.frequency, f.q, f.gain);
        });

        // Disable internal WASM SBR and Limiter to control them in JS
        this.wasmDSP_L.set_sbr_active(false);
        this.wasmDSP_R.set_sbr_active(false);

        // Set WASM limiter threshold high to bypass (we do it in JS)
        this.wasmDSP_L.set_limiter(100.0, 0.5);
        this.wasmDSP_R.set_limiter(100.0, 0.5);

        this.wasmDSP_L.set_gain(this.outputGain);
        this.wasmDSP_R.set_gain(this.outputGain);
    }

    handleMessage(data) {
        switch (data.type) {
            case 'initialState':
                if (data.sbrOptions) {
                    this.sbr.setOptions(data.sbrOptions.enabled, data.sbrOptions.gain);
                }
                if (data.limiterOptions) {
                    this.dynamics.setLimiterOptions(data.limiterOptions.enabled, data.limiterOptions.attack);
                }
                if (data.visualizerFps) {
                    this.visualizerFps = data.visualizerFps;
                    this.framesPerRender = sampleRate / this.visualizerFps;
                }
                if (data.gain) {
                    this.outputGain = data.gain;
                    if (this.wasmLoaded) {
                        this.wasmDSP_L.set_gain(data.gain);
                        this.wasmDSP_R.set_gain(data.gain);
                    }
                }
                if (data.filters) {
                    // Full state sync not fully utilized in this msg format usually, handled individually
                }
            // Flow through
            case 'modifyFilter':
                if (data.index >= 0 && data.index < this.numFilters) {
                    const filters = this.filters.filters;

                    filters[data.index].frequency = data.frequency;
                    filters[data.index].gain = data.gain;
                    filters[data.index].q = data.q;
                    this.filters.calculateBiquadCoefficients(filters[data.index]);

                    if (this.wasmLoaded) {
                        let f = filters[data.index];
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
                const filters = this.filters.filters;
                filters.forEach((filter, i) => {
                    filter.gain = 0;
                    this.filters.calculateBiquadCoefficients(filter);
                    if (this.wasmLoaded) {
                        this.wasmDSP_L.set_filter(i, 1, filter.frequency, filter.q, 0.0);
                        this.wasmDSP_R.set_filter(i, 1, filter.frequency, filter.q, 0.0);
                    }
                });
                this.outputGain = 1.0;
                break;
            case 'setQualityMode':
                this.filters.setQualityMode(data.mode);

                // Update WASM filters with new Q
                if (this.wasmLoaded) {
                    const fl = this.filters.filters;
                    fl.forEach((filter, i) => {
                        let typeId = 1;
                        if (filter.type === 'lowshelf') typeId = 0;
                        if (filter.type === 'highshelf') typeId = 2;
                        this.wasmDSP_L.set_filter(i, typeId, filter.frequency, filter.q, filter.gain);
                        this.wasmDSP_R.set_filter(i, typeId, filter.frequency, filter.q, filter.gain);
                    });
                }
                break;
            case 'setSbrOptions':
                this.sbr.setOptions(data.options.enabled, data.options.gain);
                break;
            case 'setLimiterOptions':
                this.dynamics.setLimiterOptions(data.options.enabled, data.options.attack);
                break;
            case 'setVisualizerFps':
                this.visualizerFps = data.fps;
                this.framesPerRender = sampleRate / data.fps;
                break;
        }
    }

    processWasm(input, output, blockSize) {
        // 1. EQ (WASM)
        if (input[0] && output[0]) {
            this.wasmDSP_L.process_block(input[0], output[0]);
        }
        if (input[1] && output[1]) {
            this.wasmDSP_R.process_block(input[1], output[1]);
        }

        // 2 & 3 & 4. JS Processing chain (SBR -> Compressor -> Limiter)
        const left = output[0];
        const right = output[1] || output[0];

        // SBR
        this.sbr.processBlock(left, right, blockSize);

        // Dynamics (Compressor + Limiter)
        this.dynamics.processBlock(left, right, blockSize);

        // FFT Analysis & SBR Detection (JS Side)
        if (output[0]) {
            const buffer = this.fft.getBuffer();

            // Visualize Buffer - Sliding Window
            buffer.copyWithin(0, blockSize);

            // Fill new data (Mix L+R)
            for (let i = 0; i < blockSize; i++) {
                buffer[this.fftSize - blockSize + i] = (left[i] + (output[1] ? right[i] : left[i])) * 0.5;
            }

            this.samplesSinceLastFft += blockSize;

            // Throttled by FPS
            if (this.samplesSinceLastFft >= this.framesPerRender) {
                this.samplesSinceLastFft = 0;

                const fftData = this.fft.performFFT(buffer);
                this.sbr.detectSBR(fftData);

                let reductionDb = 0;
                let minRed = this.dynamics.getMinReduction();
                if (minRed < 1.0) {
                    reductionDb = 20 * Math.log10(minRed);
                    this.dynamics.resetMinReduction();
                }

                this.port.postMessage({
                    type: 'fftData',
                    data: fftData,
                    limiterReduction: reductionDb,
                    sbrActive: this.sbr.sbrActive
                });
            }
        }
        return true;
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

        // If Wasm not loaded, BYPASS DSP but keep Visualization
        for (let ch = 0; ch < numChannels; ch++) {
            output[ch].set(input[ch]);
        }

        // Visualization
        const left = output[0];
        const right = output[1] || output[0];
        const buffer = this.fft.getBuffer();

        // Sliding window or linear fill? Consistent with processWasm
        buffer.copyWithin(0, blockSize);
        for (let i = 0; i < blockSize; i++) {
            buffer[this.fftSize - blockSize + i] = (left[i] + (output[1] ? right[i] : left[i])) * 0.5;
        }

        this.samplesSinceLastFft += blockSize;
        if (this.samplesSinceLastFft >= this.framesPerRender) {
            this.samplesSinceLastFft = 0;
            const fftData = this.fft.performFFT(buffer);
            this.sbr.detectSBR(fftData); // Detect even if SBR not applied

            this.port.postMessage({
                type: 'fftData',
                data: fftData,
                limiterReduction: 0,
                sbrActive: this.sbr.sbrActive
            });
        }
        return true;
    }
}

registerProcessor('juragan-audio-processor', JuraganAudioProcessor);
