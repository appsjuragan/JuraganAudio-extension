use wasm_bindgen::prelude::*;

mod filters;
mod dynamics;
mod analysis;

use filters::iir::{BiquadFilter, FilterType};
use filters::fir::FirFilter;
use dynamics::limiter::Limiter;
use analysis::fft::FftAnalyzer;

#[wasm_bindgen]
pub struct EarsDSP {
    sample_rate: f32,
    filters: Vec<BiquadFilter>,
    limiter: Limiter,
    fir_filters: Vec<FirFilter>,
    use_fir: bool,
    fft_analyzer: FftAnalyzer,
}

#[wasm_bindgen]
impl EarsDSP {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let mut filters = Vec::with_capacity(11);
        let mut fir_filters = Vec::with_capacity(11);
        
        for _ in 0..11 {
            filters.push(BiquadFilter::new(sample_rate));
            fir_filters.push(FirFilter::create_lowpass(1000.0, sample_rate, 127)); // Default dummy FIR
        }
        
        Self {
            sample_rate,
            filters,
            limiter: Limiter::new(sample_rate),
            fir_filters,
            use_fir: false,
            fft_analyzer: FftAnalyzer::new(4096),
        }
    }
    
    pub fn set_filter(&mut self, index: usize, type_id: u8, freq: f32, q: f32, gain: f32) {
        if index < self.filters.len() {
            let filter_type = match type_id {
                0 => FilterType::LowShelf,
                1 => FilterType::Peaking,
                2 => FilterType::HighShelf,
                _ => FilterType::Peaking,
            };
            self.filters[index].set_params(filter_type, freq, q, gain);
        }
    }

    pub fn set_use_fir(&mut self, use_fir: bool) {
        self.use_fir = use_fir;
    }
    
    pub fn process_block(&mut self, input: &mut [f32], output: &mut [f32]) {
        for (i, sample) in input.iter().enumerate() {
            let mut s = *sample;
            
            if self.use_fir {
                 for filter in &mut self.fir_filters {
                    s = filter.process(s);
                 }
            } else {
                // Apply IIR filter chain
                for filter in &mut self.filters {
                    s = filter.process(s);
                }
            }
            
            // Apply limiter
            s = self.limiter.process(s);
            
            output[i] = s;
        }
    }

    pub fn get_fft(&mut self, input: &[f32]) -> Vec<f32> {
        self.fft_analyzer.process(input)
    }
}
