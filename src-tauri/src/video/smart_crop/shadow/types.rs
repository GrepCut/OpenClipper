use serde::Serialize;

use crate::video::smart_crop::vision_logic::NormalizedBox;

#[derive(Clone, Debug, Default)]
pub struct GeneralizationShadowConfig {
    pub transnet: bool,
    pub osnet: bool,
    pub vinet: bool,
}

impl GeneralizationShadowConfig {
    pub fn resolve() -> Self {
        let enable_shadow = env_flag("CLIPPER_ENABLE_SHADOW");
        // Production cut fuse without enabling OSNet/ViNet shadow diagnostics.
        let use_transnet_cuts = env_flag("CLIPPER_USE_TRANSNET_CUTS");
        Self {
            transnet: enable_shadow || use_transnet_cuts,
            osnet: enable_shadow,
            vinet: enable_shadow,
        }
    }

    pub fn any_enabled(&self) -> bool {
        self.transnet || self.osnet || self.vinet
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransNetShadowSample {
    pub time: f64,
    pub single_frame_probability: f32,
    pub many_frame_probability: f32,
    pub histogram_scene_cut: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaliencyShadowSample {
    pub time: f64,
    #[serde(rename = "box")]
    pub box_: NormalizedBox,
    pub confidence: f32,
    pub kind: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReIdShadowSample {
    pub time: f64,
    pub person_count: usize,
    pub embedding_dim: usize,
    pub embedding_norm: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransNetCalibration {
    pub sample_count: usize,
    pub histogram_cut_count: usize,
    pub transnet_cut_count: usize,
    pub agreement_rate: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralizationShadowDiagnostics {
    pub enabled_models: Vec<&'static str>,
    pub transnet_samples: Vec<TransNetShadowSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transnet_calibration: Option<TransNetCalibration>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub saliency_proxy_samples: Vec<SaliencyShadowSample>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reid_samples: Vec<ReIdShadowSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub osnet_ready: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reid_trigger_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vinet_ready: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vinet_note: Option<&'static str>,
}
