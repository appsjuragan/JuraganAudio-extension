use wasm_bindgen::prelude::*;
use std::f32::consts::PI;

// Simple IIR Lowpass for SBR Gen
struct LowPassFilter {
    y1: f32,
    alpha: f32,
}

impl LowPassFilter {
    fn new(alpha: f32) -> Self {
        Self { y1: 0.0, alpha }
    }
    
    fn process(&mut self, input: f32) -> f32 {
        let output = self.y1 + self.alpha * (input - self.y1);
        self.y1 = output;
        output
    }
}

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

// PRNG for Noise
struct Xorshift32 {
    seed: u32,
}

impl Xorshift32 {
    fn new(seed: u32) -> Self {
        Self { seed: seed.max(1) }
    }
    
    // Returns float inside [-1.0, 1.0]
    fn next_f32(&mut self) -> f32 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        // Normalize to [-1.0, 1.0] roughly
        (x as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

// Per-channel state
struct SbrChannelState {
    hp: HighPassFilter,
    lpf: LowPassFilter,
    synth_hp: HighPassFilter,
    env_fast: f32,
    env_slow: f32,
    tail: f32,
    noise_hp: f32,
    noise_x1: f32,
}

impl SbrChannelState {
    fn new(alpha_hpf: f32, alpha_lpf: f32, alpha_synth_hpf: f32) -> Self {
        Self {
            hp: HighPassFilter::new(alpha_hpf),
            lpf: LowPassFilter::new(alpha_lpf),
            synth_hp: HighPassFilter::new(alpha_synth_hpf),
            env_fast: 0.0,
            env_slow: 0.0,
            tail: 0.0,
            noise_hp: 0.0,
            noise_x1: 0.0,
        }
    }
}

#[wasm_bindgen]
pub struct SBRProcessor {
    left: SbrChannelState,
    right: SbrChannelState,
    
    // Shared constant params
    alpha_hpf: f32,
    alpha_fast: f32,
    alpha_slow: f32,
    tail_decay: f32,
    
    params_gain: f32,
    params_enabled: bool,
    
    rng_left: Xorshift32,
    rng_right: Xorshift32,
}

#[wasm_bindgen]
impl SBRProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let alpha_hpf = 0.6; // Highpass for detection
        
        // Lowpass cutoff at 20000Hz to ensure SBR content reaches at least 18khz clearly
        let fc = 20000.0;
        let alpha_lpf = 1.0 - (-2.0 * PI * fc / sample_rate).exp();
        let synth_hp_fc = 6000.0;
        let alpha_synth_hpf = (-2.0 * PI * synth_hp_fc / sample_rate).exp();
        
        Self {
            left: SbrChannelState::new(alpha_hpf, alpha_lpf, alpha_synth_hpf),
            right: SbrChannelState::new(alpha_hpf, alpha_lpf, alpha_synth_hpf),
            
            alpha_hpf,
            alpha_fast: 0.85,
            alpha_slow: 0.992,
            tail_decay: 0.9994,
            
            params_gain: 1.0,
            params_enabled: false,
            
            rng_left: Xorshift32::new(12345),
            rng_right: Xorshift32::new(54321),
        }
    }
    
    pub fn set_options(&mut self, enabled: bool, gain: f32) {
        self.params_enabled = enabled;
        self.params_gain = gain;
    }

    pub fn is_enabled(&self) -> bool {
        self.params_enabled
    }
    
    pub fn process_block(&mut self, input_l: &mut [f32], input_r: &mut [f32], sbr_active: bool) {
        if !self.params_enabled || !sbr_active {
            return;
        }

        let makeup = 0.8 * self.params_gain;
        let block_size = input_l.len().min(input_r.len());

        for i in 0..block_size {
            let l = input_l[i];
            let r = input_r[i];
            
            // --- Left Channel Process ---
            // 1. High Pass Filter (Detection)
            let hp_l = self.alpha_hpf * (self.left.hp.y1 + l - self.left.hp.x1);
            self.left.hp.x1 = l;
            self.left.hp.y1 = hp_l;
            
            // 2. Harmonic Generator
            let harm_l = hp_l.abs();
            
            // 3. Transient Detection
            self.left.env_fast = self.alpha_fast * self.left.env_fast + (1.0 - self.alpha_fast) * harm_l;
            self.left.env_slow = self.alpha_slow * self.left.env_slow + (1.0 - self.alpha_slow) * harm_l;
            
            // 4. Pulse Stretcher
            let trigger_l = (self.left.env_fast - self.left.env_slow * 1.6).max(0.0);
            
            if trigger_l > self.left.tail {
                self.left.tail = trigger_l;
            } else {
                self.left.tail *= self.tail_decay;
            }
            
            // 5. Synthesis
            let syn_gain_l = (self.left.tail * 15.0).min(1.0);
            
            // Noise
            let n_l = self.rng_left.next_f32();
            self.left.noise_hp = 0.3 * (self.left.noise_hp + n_l - self.left.noise_x1);
            self.left.noise_x1 = n_l;
            
            // Generated Signal (Harmonics + Noise)
            let mut generated_l = (harm_l * syn_gain_l * makeup) + (self.left.noise_hp * syn_gain_l * makeup * 0.15);
            
            // Highpass to focus on missing band
            generated_l = self.left.synth_hp.process(generated_l);

            // LPF
            generated_l = self.left.lpf.process(generated_l);
            
            // Mix Left
            input_l[i] = l + generated_l;


            // --- Right Channel Process ---
            // 1. High Pass Filter
            let hp_r = self.alpha_hpf * (self.right.hp.y1 + r - self.right.hp.x1);
            self.right.hp.x1 = r;
            self.right.hp.y1 = hp_r;
            
            // 2. Harmonic Generator
            let harm_r = hp_r.abs();
            
            // 3. Transient Detection
            self.right.env_fast = self.alpha_fast * self.right.env_fast + (1.0 - self.alpha_fast) * harm_r;
            self.right.env_slow = self.alpha_slow * self.right.env_slow + (1.0 - self.alpha_slow) * harm_r;
            
            // 4. Pulse Stretcher
            let trigger_r = (self.right.env_fast - self.right.env_slow * 1.6).max(0.0);
            
            if trigger_r > self.right.tail {
                self.right.tail = trigger_r;
            } else {
                self.right.tail *= self.tail_decay;
            }
            
            // 5. Synthesis
            let syn_gain_r = (self.right.tail * 15.0).min(1.0);
            
            // Noise
            let n_r = self.rng_right.next_f32();
            self.right.noise_hp = 0.3 * (self.right.noise_hp + n_r - self.right.noise_x1);
            self.right.noise_x1 = n_r;
            
            // Generated Signal
            let mut generated_r = (harm_r * syn_gain_r * makeup) + (self.right.noise_hp * syn_gain_r * makeup * 0.15);
            
            // Highpass to focus on missing band
            generated_r = self.right.synth_hp.process(generated_r);

            // LPF
            generated_r = self.right.lpf.process(generated_r);
            
            // Mix Right
            input_r[i] = r + generated_r;
        }
    }
}
