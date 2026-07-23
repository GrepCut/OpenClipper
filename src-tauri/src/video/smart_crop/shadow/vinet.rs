use std::path::Path;

use super::preprocess::{
    resize_rgb_to_vinet_frame, saliency_map_to_box, VINET_CLIPS, VINET_HEIGHT, VINET_PLANE,
    VINET_WIDTH,
};
use super::types::SaliencyShadowSample;

use crate::video::smart_crop::vision::{NativeVisionError, VisionModel, WinMlModel};

pub(super) struct ViNetShadow {
    model: WinMlModel,
    clips: Vec<Vec<f32>>,
    times: Vec<f64>,
    samples: Vec<SaliencyShadowSample>,
}

impl ViNetShadow {
    pub(super) fn open(path: &Path) -> Result<Self, NativeVisionError> {
        let model = WinMlModel::create_multi(VisionModel::ViNet, path, &["saliency"])?;
        Ok(Self {
            model,
            clips: Vec::with_capacity(VINET_CLIPS),
            times: Vec::with_capacity(VINET_CLIPS),
            samples: Vec::new(),
        })
    }

    pub(super) fn push_frame(
        &mut self,
        rgb: &[u8],
        width: usize,
        height: usize,
        time: f64,
    ) -> Option<SaliencyShadowSample> {
        let mut plane = vec![0.0f32; VINET_PLANE];
        resize_rgb_to_vinet_frame(rgb, width, height, &mut plane);
        self.clips.push(plane);
        self.times.push(time);
        if self.clips.len() < VINET_CLIPS {
            return None;
        }
        let sample = self.evaluate_center().ok();
        self.clips.remove(0);
        self.times.remove(0);
        sample
    }

    fn evaluate_center(&mut self) -> Result<SaliencyShadowSample, NativeVisionError> {
        let mut input = vec![0.0f32; VINET_PLANE * VINET_CLIPS];
        for (clip_index, clip) in self.clips.iter().enumerate() {
            for channel in 0..3 {
                for y in 0..VINET_HEIGHT {
                    for x in 0..VINET_WIDTH {
                        let src = clip[channel * VINET_HEIGHT * VINET_WIDTH + y * VINET_WIDTH + x];
                        let dst = ((channel * VINET_CLIPS + clip_index) * VINET_HEIGHT + y)
                            * VINET_WIDTH
                            + x;
                        input[dst] = src;
                    }
                }
            }
        }
        let shape = [
            1,
            3,
            VINET_CLIPS as i64,
            VINET_HEIGHT as i64,
            VINET_WIDTH as i64,
        ];
        let outputs = self.model.evaluate_named(&[("video", &shape, &input)])?;
        let map = outputs.into_iter().next().unwrap_or_default();
        let center = VINET_CLIPS / 2;
        let (box_, confidence) = saliency_map_to_box(&map, VINET_WIDTH, VINET_HEIGHT);
        Ok(SaliencyShadowSample {
            time: self.times[center],
            box_,
            confidence,
            kind: "video-saliency",
        })
    }

    pub(super) fn finish(mut self) -> Vec<SaliencyShadowSample> {
        while self.clips.len() >= VINET_CLIPS {
            if let Ok(sample) = self.evaluate_center() {
                self.samples.push(sample);
            }
            self.clips.remove(0);
            self.times.remove(0);
        }
        self.samples
    }
}
