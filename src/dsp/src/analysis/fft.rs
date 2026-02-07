use rustfft::{FftPlanner, num_complex::Complex};
use rustfft::num_traits::Zero;
use std::sync::Arc;

pub struct FftAnalyzer {
    planner: FftPlanner<f32>,
    size: usize,
    buffer: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    window: Vec<f32>,
}

impl FftAnalyzer {
    pub fn new(size: usize) -> Self {
        let mut window = vec![0.0; size];
        // Hann window
        for i in 0..size {
            let n = i as f32;
            let n_max = (size - 1) as f32;
            window[i] = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * n / n_max).cos());
        }

        Self {
            planner: FftPlanner::new(),
            size,
            buffer: vec![Complex::zero(); size],
            scratch: vec![Complex::zero(); size], // Pre-allocate scratch
            window,
        }
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let fft = self.planner.plan_fft_forward(self.size);
        
        // Windowing and copy to complex buffer
        for i in 0..self.size {
            if i < input.len() {
                self.buffer[i] = Complex::new(input[i] * self.window[i], 0.0);
            } else {
                self.buffer[i] = Complex::zero();
            }
        }
        
        // Resize scratch if needed (though size is constant here)
        let scratch_len = fft.get_inplace_scratch_len();
        if self.scratch.len() < scratch_len {
            self.scratch.resize(scratch_len, Complex::zero());
        }

        // Perform FFT in-place with scratch
        fft.process_with_scratch(&mut self.buffer, &mut self.scratch);
        
        // Calculate magnitude
        let mut magnitudes = Vec::with_capacity(self.size / 2);
        for i in 0..self.size / 2 {
            // Normalize: divided by size is common, or just leave raw
            let magnitude = self.buffer[i].norm(); // / self.size as f32;
            magnitudes.push(magnitude);
        }
        
        magnitudes
    }
}
