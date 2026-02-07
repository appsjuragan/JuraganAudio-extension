#[derive(Clone, Debug)]
pub struct Limiter {
    threshold: f32,
    knee: f32,
    attack_coeff: f32,
    release_coeff: f32,
    envelope: f32,
    lookahead_buffer: Vec<f32>,
    lookahead_pos: usize,
    sample_rate: f32,
    min_gain: f32,
}

impl Limiter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            threshold: 0.95, // -0.5 dB
            knee: 0.5,       // Soft knee width
            attack_coeff: (-1.0 / (sample_rate * 0.005)).exp(), // 5ms attack
            release_coeff: (-1.0 / (sample_rate * 0.100)).exp(), // 100ms release
            envelope: 0.0,
            lookahead_buffer: vec![0.0; (sample_rate * 0.005) as usize], // 5ms lookahead
            lookahead_pos: 0,
            sample_rate,
            min_gain: 1.0,
        }
    }

    pub fn set_params(&mut self, threshold: f32, knee: f32) {
        self.threshold = threshold;
        self.knee = knee;
    }
    
    pub fn get_and_reset_min_gain(&mut self) -> f32 {
        let val = self.min_gain;
        self.min_gain = 1.0;
        val
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let abs_input = input.abs();
        
        // Envelope follower with attack/release
        if abs_input > self.envelope {
            self.envelope = self.attack_coeff * self.envelope + (1.0 - self.attack_coeff) * abs_input;
        } else {
            self.envelope = self.release_coeff * self.envelope + (1.0 - self.release_coeff) * abs_input;
        }

        // Calculate gain reduction
        let mut gain = 1.0;
        
        // Soft knee limiting curve
        if self.envelope > self.threshold {
            let excess = self.envelope - self.threshold;
            
            if excess < self.knee {
                // Soft knee region
                gain = self.threshold / self.envelope;
            } else {
                // Hard limiting region
                gain = self.threshold / self.envelope;
            }
        }
        
        if gain < self.min_gain {
            self.min_gain = gain;
        }

        // Apply look-ahead delay
        let delayed_input = self.lookahead_buffer[self.lookahead_pos];
        self.lookahead_buffer[self.lookahead_pos] = input;
        
        self.lookahead_pos += 1;
        if self.lookahead_pos >= self.lookahead_buffer.len() {
            self.lookahead_pos = 0;
        }
        
        delayed_input * gain
    }
}
