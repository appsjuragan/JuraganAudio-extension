use wasm_bindgen::prelude::*;

mod filters;
mod dynamics;
mod analysis;

use filters::iir::{BiquadFilter, FilterType};

use dynamics::limiter::Limiter;
use analysis::fft::FftAnalyzer;

// Simple IIR Highpass for SBR
struct HighPassFilter {
    x1: f32,
    y1: f32,
    alpha: f32,
}

impl HighPassFilter {
    fn new(alpha: f32) -> Self {
        Self { x1: 0.0, y1: 0.0, alpha }
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.alpha * (self.y1 + input - self.x1);
        self.x1 = input;
        self.y1 = output;
        output
    }
}

struct SBRProcessor {
    hp: HighPassFilter,
    gain: f32,
}

impl SBRProcessor {
    fn new() -> Self {
        Self {
            hp: HighPassFilter::new(0.75), // Higher cutoff for cleaner HF transients
            gain: 1.5, // Significantly boosted gain for "punch"
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let high_freq = self.hp.process(input);
        // Rectify to generate harmonics
        // standard full-wave rectification
        let excitation = high_freq.abs();
        
        // Mix with original
        input + (excitation * self.gain)
    }
}

#[wasm_bindgen]
pub struct JuraganAudioDSP {
    filters: Vec<BiquadFilter>,
    limiter: Limiter,
    sbr: SBRProcessor,
    sbr_active: bool,
    fft_analyzer: FftAnalyzer,
    gain: f32,
}

#[wasm_bindgen]
impl JuraganAudioDSP {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let mut filters = Vec::with_capacity(11);
        for _ in 0..11 {
            filters.push(BiquadFilter::new(sample_rate));
        }
        
        Self {
            filters,
            limiter: Limiter::new(sample_rate),
            sbr: SBRProcessor::new(),
            sbr_active: false,
            fft_analyzer: FftAnalyzer::new(4096),
            gain: 1.0,
        }
    }
    
    pub fn set_gain(&mut self, val: f32) {
        self.gain = val;
    }

    pub fn set_limiter(&mut self, threshold: f32, knee: f32) {
        self.limiter.set_params(threshold, knee);
    }

    pub fn get_reduction_db(&mut self) -> f32 {
        let min_gain = self.limiter.get_and_reset_min_gain();
        if min_gain < 1.0 {
            20.0 * min_gain.log10()
        } else {
            0.0
        }
    }

    pub fn set_filter(&mut self, index: usize, type_id: u8, freq: f32, q: f32, gain: f32) {
        if index < self.filters.len() {
             // 0: LowShelf, 1: Peaking, 2: HighShelf
             let filter_type = match type_id {
                0 => FilterType::LowShelf,
                2 => FilterType::HighShelf,
                _ => FilterType::Peaking,
            };
            self.filters[index].set_params(filter_type, freq, q, gain);
        }
    }

    pub fn set_sbr_active(&mut self, active: bool) {
        self.sbr_active = active;
    }
    
    pub fn process_block(&mut self, input: &[f32], output: &mut [f32]) {
        for (i, sample) in input.iter().enumerate() {
            let mut s = *sample;
            
            // EQ
            for filter in &mut self.filters {
                s = filter.process(s);
            }
            
            // SBR
            if self.sbr_active {
                s = self.sbr.process(s);
            }

            // Gain
            s *= self.gain;

            // Limiter
            s = self.limiter.process(s);
            
            output[i] = s;
        }
    }

    pub fn get_fft(&mut self, input: &[f32]) -> Vec<f32> {
        self.fft_analyzer.process(input)
    }
}
