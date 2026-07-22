use std::path::Path;

use super::preprocess::{
    resize_rgb_to_transnet, TRANSNET_CUT_THRESHOLD, TRANSNET_HEIGHT, TRANSNET_WIDTH,
    TRANSNET_WINDOW,
};
use super::types::{TransNetCalibration, TransNetShadowSample};

#[cfg(windows)]
use crate::video::smart_crop::vision::{NativeVisionError, VisionModel, WinMlModel};

#[cfg(windows)]
pub(super) struct TransNetShadow {
    model: WinMlModel,
    buffer: Vec<f32>,
    times: Vec<f64>,
    scene_cuts: Vec<bool>,
    samples: Vec<TransNetShadowSample>,
}

#[cfg(windows)]
impl TransNetShadow {
    pub(super) fn open(path: &Path) -> Result<Self, NativeVisionError> {
        let model = WinMlModel::create_multi(
            VisionModel::TransNet,
            path,
            &["534", "535"],
        )?;
        Ok(Self {
            model,
            buffer: Vec::with_capacity(TRANSNET_WINDOW * TRANSNET_HEIGHT * TRANSNET_WIDTH * 3),
            times: Vec::with_capacity(TRANSNET_WINDOW),
            scene_cuts: Vec::with_capacity(TRANSNET_WINDOW),
            samples: Vec::new(),
        })
    }

    pub(super) fn push_frame(
        &mut self,
        rgb: &[u8],
        width: usize,
        height: usize,
        time: f64,
        scene_cut: bool,
    ) -> bool {
        self.times.push(time);
        self.scene_cuts.push(scene_cut);
        resize_rgb_to_transnet(rgb, width, height, &mut self.buffer);
        if self.times.len() < TRANSNET_WINDOW {
            return false;
        }
        let mut cut = false;
        if let Ok((single, many)) = self.evaluate_window() {
            let center = TRANSNET_WINDOW / 2;
            cut = many[center] >= TRANSNET_CUT_THRESHOLD;
            self.samples.push(TransNetShadowSample {
                time: self.times[center],
                single_frame_probability: single[center],
                many_frame_probability: many[center],
                histogram_scene_cut: self.scene_cuts[center],
            });
        }
        self.times.remove(0);
        self.scene_cuts.remove(0);
        let plane = TRANSNET_HEIGHT * TRANSNET_WIDTH * 3;
        self.buffer.drain(..plane);
        cut
    }

    fn evaluate_window(&mut self) -> Result<(Vec<f32>, Vec<f32>), NativeVisionError> {
        let shape = [
            1,
            TRANSNET_WINDOW as i64,
            TRANSNET_HEIGHT as i64,
            TRANSNET_WIDTH as i64,
            3,
        ];
        let outputs = self.model.evaluate(&shape, &self.buffer)?;
        let frame_count = TRANSNET_WINDOW;
        let mut single = vec![0.0f32; frame_count];
        let mut many = vec![0.0f32; frame_count];
        if outputs.len() >= 2 && outputs[0].len() >= frame_count && outputs[1].len() >= frame_count {
            single.copy_from_slice(&outputs[0][..frame_count]);
            many.copy_from_slice(&outputs[1][..frame_count]);
        }
        Ok((single, many))
    }

    pub(super) fn finish(mut self) -> Vec<TransNetShadowSample> {
        while self.times.len() >= TRANSNET_WINDOW {
            if let Ok((single, many)) = self.evaluate_window() {
                let center = TRANSNET_WINDOW / 2;
                self.samples.push(TransNetShadowSample {
                    time: self.times[center],
                    single_frame_probability: single[center],
                    many_frame_probability: many[center],
                    histogram_scene_cut: self.scene_cuts[center],
                });
            }
            self.times.remove(0);
            self.scene_cuts.remove(0);
            let plane = TRANSNET_HEIGHT * TRANSNET_WIDTH * 3;
            self.buffer.drain(..plane);
        }
        self.samples
    }
}

pub fn calibrate_transnet_vs_histogram(samples: &[TransNetShadowSample]) -> TransNetCalibration {
    if samples.is_empty() {
        return TransNetCalibration {
            sample_count: 0,
            histogram_cut_count: 0,
            transnet_cut_count: 0,
            agreement_rate: 0.0,
        };
    }
    let histogram_cut_count = samples.iter().filter(|sample| sample.histogram_scene_cut).count();
    let transnet_cut_count = samples
        .iter()
        .filter(|sample| sample.many_frame_probability >= TRANSNET_CUT_THRESHOLD)
        .count();
    let agreements = samples
        .iter()
        .filter(|sample| {
            sample.histogram_scene_cut
                == (sample.many_frame_probability >= TRANSNET_CUT_THRESHOLD)
        })
        .count();
    TransNetCalibration {
        sample_count: samples.len(),
        histogram_cut_count,
        transnet_cut_count,
        agreement_rate: agreements as f32 / samples.len() as f32,
    }
}
