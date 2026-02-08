export class JuraganAudioSBR {
    constructor() {
        this.sbrEnabled = false;
        this.sbrActive = false;
        this.sbrUserGain = 1.0;
        // ... (rest of constructor remains similar but we initialize sbrActive)
        this.envFastL = 0.0;
        this.envSlowL = 0.0;
        this.tailL = 0.0;
        this.envFastR = 0.0;
        this.envSlowR = 0.0;
        this.tailR = 0.0;
        this.sbrHp1 = { x1: 0, y1: 0 };
        this.sbrHp2 = { x1: 0, y1: 0 };
        this.noiseHpL = 0; this.noiseX1L = 0;
        this.noiseHpR = 0; this.noiseX1R = 0;
        this.alphaHpf = 0.6;
        this.alphaFast = 0.85;
        this.alphaSlow = 0.992;
        this.tailDecay = 0.9994;
    }

    setOptions(enabled, gain) {
        this.sbrEnabled = enabled;
        if (!enabled) this.sbrActive = false;
        if (gain !== undefined) this.sbrUserGain = gain;
    }

    detectSBR(magnitudes, sampleRate) {
        if (!this.sbrEnabled) {
            this.sbrActive = false;
            return;
        }

        const binSize = sampleRate / 8192; // FFT Size is 8192 (4096*2)

        const refStart = Math.floor(2000 / binSize);
        const refEnd = Math.floor(4500 / binSize);
        const cutStart = Math.floor(8000 / binSize);
        const cutEnd = Math.floor(12000 / binSize);
        const highStart = Math.floor(14000 / binSize);
        const highEnd = Math.floor(18000 / binSize);

        let sumRef = 0, countRef = 0;
        for (let i = refStart; i < refEnd && i < magnitudes.length; i++) {
            sumRef += magnitudes[i];
            countRef++;
        }

        let sumCut = 0, countCut = 0;
        for (let i = cutStart; i < cutEnd && i < magnitudes.length; i++) {
            sumCut += magnitudes[i];
            countCut++;
        }

        let sumHigh = 0, countHigh = 0;
        for (let i = highStart; i < highEnd && i < magnitudes.length; i++) {
            sumHigh += magnitudes[i];
            countHigh++;
        }

        const avgRef = countRef > 0 ? sumRef / countRef : 0.0001;
        const avgCut = countCut > 0 ? sumCut / countCut : 0;
        const avgHigh = countHigh > 0 ? sumHigh / countHigh : 0;

        if (avgRef > 0.002) {
            const hifiRatio = avgHigh / avgRef;
            const cutoffRatio = avgCut / avgRef;

            if (hifiRatio > 0.02) {
                this.sbrActive = false;
                return;
            }

            if (cutoffRatio < 0.04) {
                this.sbrActive = true;
            } else {
                this.sbrActive = false;
            }
        }
    }

    processBlock(blockL, blockR, blockSize) {
        if (!this.sbrEnabled || !this.sbrActive) return;

        const makeup = 0.8 * this.sbrUserGain;

        for (let i = 0; i < blockSize; i++) {
            let l = blockL[i];
            let r = blockR[i] || l;

            // 1. High Pass Filter (Targeting Hats/Cymbals air band)
            let hpL = this.alphaHpf * (this.sbrHp1.y1 + l - this.sbrHp1.x1);
            this.sbrHp1.x1 = l; this.sbrHp1.y1 = hpL;

            let hpR = this.alphaHpf * (this.sbrHp2.y1 + r - this.sbrHp2.x1);
            this.sbrHp2.x1 = r; this.sbrHp2.y1 = hpR;

            // 2. Harmonic Generator (Rectification)
            let harmL = Math.abs(hpL);
            let harmR = Math.abs(hpR);

            // 3. Advanced Transient Detection
            this.envFastL = this.alphaFast * this.envFastL + (1.0 - this.alphaFast) * harmL;
            this.envSlowL = this.alphaSlow * this.envSlowL + (1.0 - this.alphaSlow) * harmL;

            this.envFastR = this.alphaFast * this.envFastR + (1.0 - this.alphaFast) * harmR;
            this.envSlowR = this.alphaSlow * this.envSlowR + (1.0 - this.alphaSlow) * harmR;

            // 4. Pulse Stretcher (Reconstruct the Shimmer)
            // Look for sudden spikes relative to the steady high-end background
            let triggerL = Math.max(0, this.envFastL - this.envSlowL * 1.6);
            let triggerR = Math.max(0, this.envFastR - this.envSlowR * 1.6);

            // Trigger the tail or decay it
            if (triggerL > this.tailL) this.tailL = triggerL;
            else this.tailL *= this.tailDecay;

            if (triggerR > this.tailR) this.tailR = triggerR;
            else this.tailR *= this.tailDecay;

            // 5. Synthesis & Reconstruction
            let synGainL = Math.min(1.0, this.tailL * 15.0);
            let synGainR = Math.min(1.0, this.tailR * 15.0);

            // Generate "Air Fizz" (High-passed white noise pulse)
            let n = (Math.random() * 2.0 - 1.0);
            this.noiseHpL = 0.3 * (this.noiseHpL + n - this.noiseX1L);
            this.noiseX1L = n;
            this.noiseHpR = 0.3 * (this.noiseHpR + n - this.noiseX1R);
            this.noiseX1R = n;

            // Mix: Original + Harmonics + Synthetic Fizz
            blockL[i] = l + (harmL * synGainL * makeup) + (this.noiseHpL * synGainL * makeup * 0.15);
            if (blockR) blockR[i] = r + (harmR * synGainR * makeup) + (this.noiseHpR * synGainR * makeup * 0.15);
        }
    }
}
