use realfft::RealFftPlanner;
use std::f64::consts::PI;

/// `python_speech_features.mfcc` defaults for signed 16-bit, 16 kHz PCM
/// (`winlen=0.025`, `winstep=0.010`, `numcep=13`, `nfilt=26`, `nfft=512`,
/// `preemph=0.97`, `ceplifter=22`, `appendEnergy=True`).
pub(super) struct Mfcc {
    fft: std::sync::Arc<dyn realfft::RealToComplex<f64>>,
    filters: Vec<Vec<(usize, f64)>>,
    cepstra: [[f64; 26]; 13],
}

impl Mfcc {
    pub(super) fn new() -> Self {
        let fft = RealFftPlanner::new().plan_fft_forward(512);
        let high_mel = 2595.0 * (1.0_f64 + 8000.0 / 700.0).log10();
        let bins: Vec<_> = (0..28)
            .map(|i| {
                let hz = 700.0 * (10.0_f64.powf(high_mel * i as f64 / (27.0 * 2595.0)) - 1.0);
                ((513.0 * hz / 16000.0).floor() as usize).min(256)
            })
            .collect();
        let filters = bins
            .windows(3)
            .map(|b| {
                (b[0]..b[2])
                    .map(|k| {
                        let weight = if k < b[1] {
                            (k - b[0]) as f64 / (b[1] - b[0]) as f64
                        } else {
                            (b[2] - k) as f64 / (b[2] - b[1]) as f64
                        };
                        (k, weight)
                    })
                    .collect()
            })
            .collect();
        let cepstra = std::array::from_fn(|c| {
            std::array::from_fn(|j| {
                let norm = if c == 0 {
                    (1.0_f64 / 26.0).sqrt()
                } else {
                    (2.0_f64 / 26.0).sqrt()
                };
                norm * (PI * c as f64 * (j as f64 + 0.5) / 26.0).cos()
                    * (1.0 + 11.0 * (PI * c as f64 / 22.0).sin())
            })
        });
        Self {
            fft,
            filters,
            cepstra,
        }
    }

    pub(super) fn compute(&self, pcm: &[f32]) -> Vec<f32> {
        let mut frame = self.fft.make_input_vec();
        let mut spectrum = self.fft.make_output_vec();
        let mut scratch = self.fft.make_scratch_vec();
        let mut result = Vec::with_capacity(1300);
        for start in (0usize..16000).step_by(160) {
            frame.fill(0.0);
            for (i, dest) in frame[..400].iter_mut().enumerate() {
                let k = start + i;
                if k >= pcm.len() {
                    *dest = 0.0;
                    continue;
                }
                let current = pcm[k] as f64;
                let previous = k.checked_sub(1).map_or(0.0, |p| pcm[p] as f64);
                *dest = current - previous * 0.97;
            }
            self.fft
                .process_with_scratch(&mut frame, &mut spectrum, &mut scratch)
                .expect("fixed FFT size");
            let power = |k: usize| spectrum[k].norm_sqr() / 512.0;
            let energy = spectrum.iter().map(|z| z.norm_sqr() / 512.0).sum::<f64>();
            let log_banks: Vec<_> = self
                .filters
                .iter()
                .map(|bank| {
                    bank.iter()
                        .map(|&(k, w)| power(k) * w)
                        .sum::<f64>()
                        .max(f64::EPSILON)
                        .ln()
                })
                .collect();
            result.push(energy.max(f64::EPSILON).ln() as f32);
            for c in &self.cepstra[1..] {
                result.push(
                    c.iter()
                        .zip(&log_banks)
                        .map(|(w, v)| w * v)
                        .sum::<f64>() as f32,
                );
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn matches_python_speech_features() {
        let pcm: Vec<_> = (0..16000)
            .map(|k| (k % 101) as f32 * 37.0 - 1200.0)
            .collect();
        let features = super::Mfcc::new().compute(&pcm);
        for (a, b) in features.iter().zip([
            16.876056, -9.508856, -0.710587, -3.231348, -1.116773, -2.055832, -1.481463,
            -2.829019, -3.175460, -4.236222, -4.458747, -5.767869, -5.892983,
        ]) {
            assert!((a - b).abs() < 0.001, "{a} != {b}");
        }
        assert_eq!(features.len(), 1300);
        assert!(features.iter().all(|v| v.is_finite()));
    }
}
