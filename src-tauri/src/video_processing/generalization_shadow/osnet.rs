use std::path::Path;

use super::preprocess::{resize_rgb_crop_to_reid, REID_HEIGHT, REID_WIDTH};
use crate::video_processing::vision_logic::NormalizedBox;
use crate::video_processing::winml_vision::{NativeVisionError, VisionModel, WinMlModel};

pub(super) struct OsnetShadow {
    model: WinMlModel,
}

impl OsnetShadow {
    pub(super) fn open(path: &Path) -> Result<Self, NativeVisionError> {
        let model = WinMlModel::create_multi(VisionModel::ReId, path, &["output"])?;
        Ok(Self { model })
    }

    pub(super) fn embed_person(
        &mut self,
        rgb: &[u8],
        width: usize,
        height: usize,
        box_: NormalizedBox,
    ) -> Result<Vec<f32>, NativeVisionError> {
        let mut input = vec![0.0f32; 3 * REID_HEIGHT * REID_WIDTH];
        resize_rgb_crop_to_reid(rgb, width, height, box_, &mut input);
        let shape = [1, 3, REID_HEIGHT as i64, REID_WIDTH as i64];
        let outputs = self
            .model
            .evaluate_named(&[("input", &shape, &input)])?;
        Ok(outputs.into_iter().next().unwrap_or_default())
    }
}
