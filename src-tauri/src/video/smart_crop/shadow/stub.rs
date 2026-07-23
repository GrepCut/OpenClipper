use std::path::Path;

use super::types::{
    GeneralizationShadowConfig, GeneralizationShadowDiagnostics, SaliencyShadowSample,
};
use crate::video::smart_crop::vision_logic::NormalizedBox;

pub struct GeneralizationShadowRunner;

impl GeneralizationShadowRunner {
    pub fn open(
        _config: GeneralizationShadowConfig,
        _transnet_path: &Path,
        _osnet_path: &Path,
        _vinet_path: &Path,
    ) -> Self {
        Self
    }

    pub fn record_reid_context(
        &mut self,
        _time: f64,
        _person_count: usize,
        _person_box: Option<NormalizedBox>,
    ) -> Option<Vec<f32>> {
        None
    }

    pub fn latest_saliency(&self) -> Option<&SaliencyShadowSample> {
        None
    }

    pub fn push_frame(
        &mut self,
        _rgb: &[u8],
        _width: usize,
        _height: usize,
        _time: f64,
        _scene_cut: bool,
        _motion_saliency: Option<(NormalizedBox, f32)>,
        _person_count: usize,
    ) -> bool {
        false
    }

    pub fn finish(self) -> Option<GeneralizationShadowDiagnostics> {
        None
    }
}
