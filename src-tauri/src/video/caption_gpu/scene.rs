use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionSceneWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionSceneGroup {
    pub start: f64,
    pub end: f64,
    pub words: Vec<CaptionSceneWord>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionPlateStyle {
    None,
    #[serde(rename = "group")]
    Group,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionActiveEffect {
    None,
    Color,
    #[serde(rename = "gradient-pill")]
    GradientPill,
    Glow,
    #[serde(rename = "beast-pop")]
    BeastPop,
    Pop,
    Hustle,
    #[serde(rename = "longest-color")]
    LongestColor,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionEntrance {
    None,
    #[serde(rename = "page-fade")]
    PageFade,
    #[serde(rename = "group-fade")]
    GroupFade,
    #[serde(rename = "word-blur")]
    WordBlur,
    #[serde(rename = "word-scale")]
    WordScale,
    #[serde(rename = "word-rise")]
    WordRise,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionRendererKind {
    Phrase,
    Karaoke,
    #[serde(rename = "one-word")]
    OneWord,
    Kinetic,
    Podcast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionGradient {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionScene {
    pub output_width: u32,
    pub output_height: u32,
    pub fps: f64,
    pub preset_id: String,
    pub font_family: String,
    pub font_weight: u16,
    pub font_style: String,
    pub font_size_ratio: f64,
    pub line_height_ratio: f64,
    pub word_gap_em: f64,
    pub letter_spacing_em: f64,
    pub uppercase: bool,
    pub max_width_ratio: f64,
    pub anchor_y: f64,
    pub text_color: String,
    pub active_text_color: String,
    pub active_color: String,
    pub outline_color: String,
    pub outline_width_em: f64,
    pub shadow_color: String,
    pub shadow_blur_em: f64,
    pub shadow_offset_x_em: f64,
    pub shadow_offset_y_em: f64,
    pub plate_style: CaptionPlateStyle,
    pub plate_color: String,
    pub plate_opacity: f64,
    pub plate_radius_em: f64,
    pub plate_padding_x_em: f64,
    pub plate_padding_y_em: f64,
    pub active_effect: CaptionActiveEffect,
    #[serde(default)]
    pub active_gradient: Option<CaptionGradient>,
    pub active_padding_x_em: f64,
    pub active_padding_y_em: f64,
    pub active_radius_em: f64,
    pub active_transition_sec: f64,
    pub active_scale: f64,
    pub active_rotation_deg: f64,
    pub entrance: CaptionEntrance,
    pub entrance_duration_sec: f64,
    pub entrance_scale_from: f64,
    pub entrance_blur_em: f64,
    #[serde(default = "default_one")]
    pub inactive_opacity: f64,
    #[serde(default)]
    pub active_outline_width_em: Option<f64>,
    #[serde(default)]
    pub group_scale_to: Option<f64>,
    #[serde(default)]
    pub secondary_font_family: Option<String>,
    #[serde(default)]
    pub secondary_font_size_scale: Option<f64>,
    #[serde(default)]
    pub accent_colors: Vec<String>,
    pub renderer: CaptionRendererKind,
    pub groups: Vec<CaptionSceneGroup>,
}

fn default_one() -> f64 {
    1.0
}
