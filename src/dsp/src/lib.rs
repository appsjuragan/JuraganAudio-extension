use wasm_bindgen::prelude::*;

mod filters;
mod dynamics;
mod analysis;
mod sbr;

use filters::iir::{BiquadFilter, FilterType};
use dynamics::compressor::DynamicsProcessor;
use sbr::SBRProcessor;
use analysis::fft::FftAnalyzer;

#[wasm_bindgen]
pub struct JuraganAudioDSP {
    filters_l: Vec<BiquadFilter>,
    filters_r: Vec<BiquadFilter>,
    dynamics: DynamicsProcessor,
    sbr: SBRProcessor,
    fft_analyzer: FftAnalyzer,
    gain: f32,
    
    // Internal Analysis for SBR Trigger
    analysis_buffer: Vec<f32>,
    analysis_pos: usize,
    sbr_active_timer: usize, // Samples remaining to keep SBR active
    sample_rate: f32,
}

#[wasm_bindgen]
impl JuraganAudioDSP {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let mut filters_l = Vec::with_capacity(11);
        let mut filters_r = Vec::with_capacity(11);
        for _ in 0..11 {
            filters_l.push(BiquadFilter::new(sample_rate));
            filters_r.push(BiquadFilter::new(sample_rate));
        }
        
        Self {
            filters_l,
            filters_r,
            dynamics: DynamicsProcessor::new(sample_rate),
            sbr: SBRProcessor::new(sample_rate),
            fft_analyzer: FftAnalyzer::new(4096),
            gain: 1.0,
            
            analysis_buffer: vec![0.0; 4096],
            analysis_pos: 0,
            sbr_active_timer: 0,
            sample_rate,
        }
    }
    
    pub fn set_gain(&mut self, val: f32) {
        self.gain = val;
    }

    pub fn set_limiter_options(&mut self, enabled: bool, attack: f32) {
        self.dynamics.set_limiter_options(enabled, attack);
    }
    
    pub fn get_reduction_db(&mut self) -> f32 {
        self.dynamics.get_reduction_db()
    }

    pub fn set_filter(&mut self, index: usize, type_id: u8, freq: f32, q: f32, gain: f32) {
        if index < self.filters_l.len() {
             // 0: LowShelf, 1: Peaking, 2: HighShelf
             let filter_type = match type_id {
                0 => FilterType::LowShelf,
                2 => FilterType::HighShelf,
                _ => FilterType::Peaking,
            };
            self.filters_l[index].set_params(filter_type, freq, q, gain);
            self.filters_r[index].set_params(filter_type, freq, q, gain);
        }
    }

    pub fn set_sbr_options(&mut self, enabled: bool, gain: f32) {
        self.sbr.set_options(enabled, gain);
        if !enabled {
            self.sbr_active_timer = 0;
            self.analysis_pos = 0; // Reset analysis buffer to be clean
        }
    }
    
    pub fn is_sbr_active(&self) -> bool {
        self.sbr.is_enabled() && self.sbr_active_timer > 0
    }
    
    pub fn process_stereo(&mut self, input_l: &[f32], input_r: &[f32], output_l: &mut [f32], output_r: &mut [f32]) {
        let len = input_l.len().min(input_r.len()).min(output_l.len()).min(output_r.len());
        
        // 1. EQ & Gain (Apply to output buffer first by copying input)
        for i in 0..len {
            let mut l = input_l[i];
            let mut r = input_r[i];
            
            // Left Filters
            for filter in &mut self.filters_l {
                l = filter.process(l);
            }
            // Right Filters
            for filter in &mut self.filters_r {
                r = filter.process(r);
            }
            
            // Gain
            output_l[i] = l * self.gain;
            output_r[i] = r * self.gain;
            
            // Analysis Mixing (Mono downmix post-EQ/Gain for detection)
            if self.analysis_pos < 4096 {
                self.analysis_buffer[self.analysis_pos] = (output_l[i] + output_r[i]) * 0.5;
                self.analysis_pos += 1;
            }
        }
        
        // 2. Analysis Trigger (if buffer full and SBR enabled)
        if self.analysis_pos >= 4096 {
            if self.sbr.is_enabled() {
                self.perform_sbr_analysis();
            } else {
                self.sbr_active_timer = 0;
            }
            self.analysis_pos = 0;
        }
        
        // Timer countdown
        if self.sbr_active_timer > 0 {
             if self.sbr_active_timer > len {
                 self.sbr_active_timer -= len;
             } else {
                 self.sbr_active_timer = 0;
             }
        }
        
        let sbr_is_active = self.is_sbr_active();
        
        // 3. SBR (In-place on output)
        self.sbr.process_block(output_l, output_r, sbr_is_active);
        
        // 4. Dynamics (In-place on output)
        self.dynamics.process_block(output_l, output_r);
    }
    
    fn perform_sbr_analysis(&mut self) {
        let magnitudes = self.fft_analyzer.process(&self.analysis_buffer);
        let bin_size = self.sample_rate / 4096.0;
        
        // Reference Zone: 2kHz - 4.5kHz (Reference for average music volume)
        let ref_start = (2000.0 / bin_size) as usize;
        let ref_end = (4500.0 / bin_size) as usize;
        
        // Dead Zone check: 8kHz - 12kHz (Where brick-wall compression is most obvious)
        let cut_start = (8000.0 / bin_size) as usize;
        let cut_end = (12000.0 / bin_size) as usize;

        // Presence check: 14kHz - 18kHz (If there is energy here, it's NOT a brick-wall file)
        let high_start = (14000.0 / bin_size) as usize;
        let high_end = (18000.0 / bin_size) as usize;
        
        let mut sum_ref = 0.0;
        let mut count_ref = 0;
        for i in ref_start..ref_end.min(magnitudes.len()) {
            sum_ref += magnitudes[i];
            count_ref += 1;
        }
        
        let mut sum_cut = 0.0;
        let mut count_cut = 0;
        for i in cut_start..cut_end.min(magnitudes.len()) {
            sum_cut += magnitudes[i];
            count_cut += 1;
        }

        let mut sum_high = 0.0;
        let mut count_high = 0;
        for i in high_start..high_end.min(magnitudes.len()) {
            sum_high += magnitudes[i];
            count_high += 1;
        }
        
        let avg_ref = if count_ref > 0 { sum_ref / count_ref as f32 } else { 0.0001 };
        let avg_cut = if count_cut > 0 { sum_cut / count_cut as f32 } else { 0.0 };
        let avg_high = if count_high > 0 { sum_high / count_high as f32 } else { 0.0 };
        
        // Detection Trigger:
        // 1. Must have active music signal (avg_ref > floor)
        // 2. Must NOT have significant energy in the high-frequency presence zone (High Quality check)
        // 3. Must have a massive energy drop in the cut-start zone (Brick-wall check)
        
        if avg_ref > 0.002 { 
            let hifi_ratio = avg_high / avg_ref;
            let cutoff_ratio = avg_cut / avg_ref;

            // Strict Hi-Fi exclusion: if there's any real activity > 14kHz, it's not a lo-fi file.
            if hifi_ratio > 0.02 {
                self.sbr_active_timer = 0; // Immediate disable
                return;
            }

            // Strict Cutoff detection: Only trigger if the 8k+ region is nearly dead (< 4% of reference)
            if cutoff_ratio < 0.04 { 
                self.sbr_active_timer = (self.sample_rate * 5.0) as usize;
            } else {
                // If it's not brick-walled, don't hold it. 
                // We keep the timer if it was already active to avoid flickering, 
                // but we won't refresh it.
            }
        }
    }

    pub fn get_fft(&mut self, input: &[f32]) -> Vec<f32> {
        self.fft_analyzer.process(input)
    }
}
