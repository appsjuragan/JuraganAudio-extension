use rustfft::{FftPlanner, num_complex::Complex};
use std::sync::Arc;

pub struct FftAnalyzer {
    planner: FftPlanner<f32>,
    size: usize,
    input_buffer: Vec<Complex<f32>>,
    output_buffer: Vec<Complex<f32>>,
    window: Vec<f32>,
}

impl FftAnalyzer {
    pub fn new(size: usize) -> Self {
        let mut window = vec![0.0; size];
        // Hann window
        for i in 0..size {
            window[i] = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (size - 1) as f32).cos());
        }

        Self {
            planner: FftPlanner::new(),
            size,
            input_buffer: vec![Complex::zero(); size],
            output_buffer: vec![Complex::zero(); size],
            window,
        }
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let fft = self.planner.plan_fft_forward(self.size);
        
        // Windowing and copy to complex buffer
        for i in 0..self.size {
            if i < input.len() {
                self.input_buffer[i] = Complex::new(input[i] * self.window[i], 0.0);
            } else {
                self.input_buffer[i] = Complex::zero();
            }
        }
        
        // Perform FFT
        fft.process(&mut self.input_buffer, &mut self.output_buffer);
        
        // Calculate magnitude
        let mut magnitudes = Vec::with_capacity(self.size / 2);
        for i in 0..self.size / 2 {
            let magnitude = self.output_buffer[i].norm();
            magnitudes.push(magnitude);
        }
        
        magnitudes
    }
}
