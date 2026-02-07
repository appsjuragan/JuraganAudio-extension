use std::f32::consts::PI;

#[derive(Clone, Copy, Debug)]
pub enum FilterType {
    LowPass,
    HighPass,
    BandPass,
    Notch,
    Peaking,
    LowShelf,
    HighShelf,
}

#[derive(Clone, Debug)]
pub struct BiquadFilter {
    filter_type: FilterType,
    frequency: f32,
    q: f32,
    gain: f32,
    sample_rate: f32,
    
    // Coefficients
    b0: f64, b1: f64, b2: f64,
    a1: f64, a2: f64,
    
    // State
    x1: f64, x2: f64,
    y1: f64, y2: f64,
}

impl BiquadFilter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            filter_type: FilterType::Peaking,
            frequency: 1000.0,
            q: 1.0,
            gain: 0.0,
            sample_rate,
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        }
    }

    pub fn set_params(&mut self, filter_type: FilterType, frequency: f32, q: f32, gain: f32) {
        self.filter_type = filter_type;
        self.frequency = frequency;
        self.q = q.max(0.01); // Prevent division by zero
        self.gain = gain;
        self.calculate_coefficients();
    }

    fn calculate_coefficients(&mut self) {
        let w0 = 2.0 * PI as f64 * self.frequency as f64 / self.sample_rate as f64;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * self.q as f64);
        let a = 10.0f64.powf(self.gain as f64 / 40.0); // A = 10^(dB/40) for shelving

        let b0: f64;
        let b1: f64;
        let b2: f64;
        let a0: f64;
        let a1: f64;
        let a2: f64;

        match self.filter_type {
            FilterType::LowShelf => {
                b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * a.sqrt() * alpha);
                b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
                b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * a.sqrt() * alpha);
                a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * a.sqrt() * alpha;
                a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
                a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * a.sqrt() * alpha;
            },
            FilterType::HighShelf => {
                b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * a.sqrt() * alpha);
                b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
                b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * a.sqrt() * alpha);
                a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * a.sqrt() * alpha;
                a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
                a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * a.sqrt() * alpha;
            },
            FilterType::Peaking => {
                let a_peak = 10.0f64.powf(self.gain as f64 / 40.0);
                b0 = 1.0 + alpha * a_peak;
                b1 = -2.0 * cos_w0;
                b2 = 1.0 - alpha * a_peak;
                a0 = 1.0 + alpha / a_peak;
                a1 = -2.0 * cos_w0;
                a2 = 1.0 - alpha / a_peak;
            },
            _ => {
                // Default pass-through
                b0=1.0; b1=0.0; b2=0.0; a0=1.0; a1=0.0; a2=0.0;
            }
        }

        // Normalize
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let input = input as f64;
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
                   - self.a1 * self.y1 - self.a2 * self.y2;
        
        // Update state logic
        // Use Direct Form I for better stability with floating point
        // Or Direct Form II Transposed
        // Here using Direct Form I
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;

        // Denormal protection
        if self.y1.abs() < 1.0e-20 { self.y1 = 0.0; }
        if self.y2.abs() < 1.0e-20 { self.y2 = 0.0; }

        output as f32
    }
}
