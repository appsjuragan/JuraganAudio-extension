use rustfft::{Fft, FftPlanner, num_complex::Complex};
use std::sync::Arc;

pub struct FirFilter {
    taps: Vec<f32>,
    buffer: Vec<f32>,
    position: usize,
    fft: Option<Arc<dyn Fft<f32>>>,
    planner: FftPlanner<f32>,
}

impl FirFilter {
    pub fn new(taps: Vec<f32>) -> Self {
        let len = taps.len();
        Self {
            taps,
            buffer: vec![0.0; len],
            position: 0,
            fft: None,
            planner: FftPlanner::new(),
        }
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let len = self.taps.len();
        self.buffer[self.position] = input;
        
        let mut output = 0.0;
        let mut index = self.position;
        
        // Convolution
        for i in 0..len {
            output += self.buffer[index] * self.taps[i];
            if index == 0 {
                index = len - 1;
            } else {
                index -= 1;
            }
        }
        
        self.position += 1;
        if self.position >= len {
            self.position = 0;
        }
        
        output
    }
    
    // Create linear phase windowed sinc filter
    pub fn create_lowpass(cutoff: f32, sample_rate: f32, num_taps: usize) -> Self {
        let mut taps = vec![0.0; num_taps];
        let center = (num_taps - 1) as f32 / 2.0;
        let omega = 2.0 * std::f32::consts::PI * cutoff / sample_rate;
        
        for i in 0..num_taps {
            let n = i as f32 - center;
            // Sinc function
            if n == 0.0 {
                taps[i] = omega / std::f32::consts::PI;
            } else {
                taps[i] = (omega * n).sin() / (std::f32::consts::PI * n);
            }
            
            // Blackman window
            let window = 0.42 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (num_taps - 1) as f32).cos() 
                       + 0.08 * (4.0 * std::f32::consts::PI * i as f32 / (num_taps - 1) as f32).cos();
            taps[i] *= window;
        }
        
        // Normalize gain
        let sum: f32 = taps.iter().sum();
        for i in 0..num_taps {
            taps[i] /= sum;
        }
        
        Self::new(taps)
    }
}
