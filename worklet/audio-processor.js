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

        // Dynamics (Limiter/Compressor) - JS instance kept for potential fallback or visualizer config if needed
        this.dynamics = new JuraganAudioDynamics(sampleRate);

        // SBR - JS instance kept for config
        this.sbr = new JuraganAudioSBR();

        // FFT
        this.fftSize = 4096 * 2;
        this.fft = new JuraganAudioFFT(this.fftSize);

        // Wasm State
        this.wasmDSP = null; // Single Stereo DSP instance
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

            this.wasmDSP = new JuraganAudioDSP(sampleRate);

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

            this.wasmDSP.set_filter(i, typeId, f.frequency, f.q, f.gain);
        });

        // Initialize defaults
        this.wasmDSP.set_gain(this.outputGain);
        this.wasmDSP.set_sbr_options(this.sbr.sbrEnabled, this.sbr.sbrUserGain);
        this.wasmDSP.set_limiter_options(this.dynamics.limiterEnabled, this.dynamics.limiterAttack);
    }

    handleMessage(data) {
        switch (data.type) {
            case 'initialState':
                if (data.sbrOptions) {
                    this.sbr.setOptions(data.sbrOptions.enabled, data.sbrOptions.gain);
                    if (this.wasmLoaded) {
                        this.wasmDSP.set_sbr_options(data.sbrOptions.enabled, data.sbrOptions.gain);
                    }
                }
                if (data.limiterOptions) {
                    this.dynamics.setLimiterOptions(data.limiterOptions.enabled, data.limiterOptions.attack);
                    if (this.wasmLoaded) {
                        this.wasmDSP.set_limiter_options(data.limiterOptions.enabled, data.limiterOptions.attack);
                    }
                }
                if (data.visualizerFps) {
                    this.visualizerFps = data.visualizerFps;
                    this.framesPerRender = sampleRate / this.visualizerFps;
                }
                if (data.gain) {
                    this.outputGain = data.gain;
                    if (this.wasmLoaded) {
                        this.wasmDSP.set_gain(data.gain);
                    }
                }
                if (data.filters) {
                    // Filter syncing usually handled via modifyFilter events
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

                        this.wasmDSP.set_filter(data.index, typeId, f.frequency, f.q, f.gain);
                    }
                }
                break;
            case 'modifyGain':
                this.outputGain = data.gain;
                if (this.wasmLoaded) {
                    this.wasmDSP.set_gain(data.gain);
                }
                break;
            case 'resetFilters':
                const filters = this.filters.filters;
                filters.forEach((filter, i) => {
                    filter.gain = 0;
                    this.filters.calculateBiquadCoefficients(filter);
                    if (this.wasmLoaded) {
                        this.wasmDSP.set_filter(i, 1, filter.frequency, filter.q, 0.0);
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
                        this.wasmDSP.set_filter(i, typeId, filter.frequency, filter.q, filter.gain);
                    });
                }
                break;
            case 'setSbrOptions':
                this.sbr.setOptions(data.options.enabled, data.options.gain);
                if (this.wasmLoaded) {
                    this.wasmDSP.set_sbr_options(data.options.enabled, data.options.gain);
                }
                break;
            case 'setLimiterOptions':
                this.dynamics.setLimiterOptions(data.options.enabled, data.options.attack);
                if (this.wasmLoaded) {
                    this.wasmDSP.set_limiter_options(data.options.enabled, data.options.attack);
                }
                break;
            case 'setVisualizerFps':
                this.visualizerFps = data.fps;
                this.framesPerRender = sampleRate / data.fps;
                break;
        }
    }

    processWasm(input, output, blockSize) {
        const leftIn = input[0];
        const rightIn = input[1] || input[0];
        const leftOut = output[0];
        const rightOut = output[1] || output[0];

        if (leftIn && leftOut) {
            // Stereo Processing in one go
            this.wasmDSP.process_stereo(leftIn, rightIn, leftOut, rightOut);
        }

        // FFT Analysis (Still in JS/WASM hybrid usage for Display)
        if (leftOut) {
            const buffer = this.fft.getBuffer();

            // Visualize Buffer - Sliding Window
            buffer.copyWithin(0, blockSize);

            // Fill new data (Mix L+R)
            for (let i = 0; i < blockSize; i++) {
                // Using output (processed) signal for visualizer to show effective changes
                const rSample = rightOut ? rightOut[i] : leftOut[i];
                buffer[this.fftSize - blockSize + i] = (leftOut[i] + rSample) * 0.5;
            }

            this.samplesSinceLastFft += blockSize;

            // Throttled by FPS
            if (this.samplesSinceLastFft >= this.framesPerRender) {
                this.samplesSinceLastFft = 0;

                const fftData = this.fft.performFFT(buffer);

                // Get reduction and SBR status from WASM
                let reductionDb = this.wasmDSP.get_reduction_db();
                let sbrActive = this.wasmDSP.is_sbr_active();

                this.port.postMessage({
                    type: 'fftData',
                    data: fftData,
                    limiterReduction: reductionDb,
                    sbrActive: sbrActive
                });
            }
        }
        return true;
    }

    processJs(input, output, blockSize) {
        const numChannels = Math.min(input.length, output.length);

        // 1. EQ + Gain
        for (let ch = 0; ch < numChannels; ch++) {
            const chanIn = input[ch];
            const chanOut = output[ch];
            for (let i = 0; i < blockSize; i++) {
                let s = chanIn[i];
                // Apply Filters
                this.filters.filters.forEach(f => {
                    s = this.filters.processBiquad(s, f, ch);
                });
                // Apply Gain
                chanOut[i] = s * this.outputGain;
            }
        }

        const left = output[0];
        const right = output[1] || output[0];

        // 2. SBR (JS Fallback)
        this.sbr.processBlock(left, right, blockSize);

        // 3. Dynamics (JS Fallback)
        this.dynamics.processBlock(left, right, blockSize);

        // Visualization
        const buffer = this.fft.getBuffer();
        buffer.copyWithin(0, blockSize);
        for (let i = 0; i < blockSize; i++) {
            buffer[this.fftSize - blockSize + i] = (left[i] + right[i]) * 0.5;
        }

        this.samplesSinceLastFft += blockSize;
        if (this.samplesSinceLastFft >= this.framesPerRender) {
            this.samplesSinceLastFft = 0;
            const fftData = this.fft.performFFT(buffer);

            // Perform SBR detection in JS fallback
            this.sbr.detectSBR(fftData, sampleRate);

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
        return true;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0) return true;

        const blockSize = input[0].length;

        // Use Wasm if loaded
        if (this.wasmLoaded) {
            try {
                return this.processWasm(input, output, blockSize);
            } catch (e) {
                console.error("WASM processing error, falling back to JS", e);
                this.wasmLoaded = false;
            }
        }

        // Fallback to JS Implementation
        return this.processJs(input, output, blockSize);
    }
}

registerProcessor('juragan-audio-processor', JuraganAudioProcessor);
