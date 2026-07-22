//! Generalization models (TransNetV2, OSNet, ViNet).
//!
//! ViNet saliency feeds importance signals; TransNet drives scene-cut resets;
//! OSNet embeddings assist multi-person identity fusion. Always enabled when
//! the corresponding ONNX weights exist on disk.

use std::path::Path;

use serde::Serialize;

use crate::video_processing::vision_logic::NormalizedBox;

#[cfg(windows)]
use crate::video_processing::winml_vision::{NativeVisionError, VisionModel, WinMlModel};

const TRANSNET_WINDOW: usize = 100;
const TRANSNET_HEIGHT: usize = 27;
const TRANSNET_WIDTH: usize = 48;
const TRANSNET_CUT_THRESHOLD: f32 = 0.5;

const VINET_CLIPS: usize = 32;
const VINET_HEIGHT: usize = 224;
const VINET_WIDTH: usize = 384;
const VINET_PLANE: usize = 3 * VINET_HEIGHT * VINET_WIDTH;
const REID_WIDTH: usize = 128;
const REID_HEIGHT: usize = 256;

#[derive(Clone, Debug, Default)]
pub struct GeneralizationShadowConfig {
    pub transnet: bool,
    pub osnet: bool,
    pub vinet: bool,
}

impl GeneralizationShadowConfig {
    pub fn resolve() -> Self {
        let enable_shadow = std::env::var("CLIPPER_ENABLE_SHADOW")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        Self {
            transnet: enable_shadow,
            osnet: enable_shadow,
            vinet: enable_shadow,
        }
    }

    pub fn any_enabled(&self) -> bool {
        self.transnet || self.osnet || self.vinet
    }
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

#[cfg(windows)]
struct TransNetShadow {
    model: WinMlModel,
    buffer: Vec<f32>,
    times: Vec<f64>,
    scene_cuts: Vec<bool>,
    samples: Vec<TransNetShadowSample>,
}

#[cfg(windows)]
impl TransNetShadow {
    fn open(path: &Path) -> Result<Self, NativeVisionError> {
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

    fn push_frame(&mut self, rgb: &[u8], width: usize, height: usize, time: f64, scene_cut: bool) -> bool {
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

    fn finish(mut self) -> Vec<TransNetShadowSample> {
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

#[cfg(windows)]
struct ViNetShadow {
    model: WinMlModel,
    clips: Vec<Vec<f32>>,
    times: Vec<f64>,
    samples: Vec<SaliencyShadowSample>,
}

#[cfg(windows)]
impl ViNetShadow {
    fn open(path: &Path) -> Result<Self, NativeVisionError> {
        let model = WinMlModel::create_multi(VisionModel::ViNet, path, &["saliency"])?;
        Ok(Self {
            model,
            clips: Vec::with_capacity(VINET_CLIPS),
            times: Vec::with_capacity(VINET_CLIPS),
            samples: Vec::new(),
        })
    }

    fn push_frame(
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
                        let dst = ((channel * VINET_CLIPS + clip_index) * VINET_HEIGHT + y) * VINET_WIDTH + x;
                        input[dst] = src;
                    }
                }
            }
        }
        let shape = [1, 3, VINET_CLIPS as i64, VINET_HEIGHT as i64, VINET_WIDTH as i64];
        let outputs = self
            .model
            .evaluate_named(&[("video", &shape, &input)])?;
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

    fn finish(mut self) -> Vec<SaliencyShadowSample> {
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

#[cfg(windows)]
pub struct GeneralizationShadowRunner {
    config: GeneralizationShadowConfig,
    transnet: Option<TransNetShadow>,
    vinet: Option<ViNetShadow>,
    osnet: Option<OsnetShadow>,
    osnet_ready: bool,
    vinet_ready: bool,
    saliency_proxy: Vec<SaliencyShadowSample>,
    latest_saliency: Option<SaliencyShadowSample>,
    reid_triggers: usize,
    reid_samples: Vec<ReIdShadowSample>,
    prev_gray: Option<Vec<u8>>,
    last_frame: Option<(f64, Vec<u8>, usize, usize)>,
}

#[cfg(windows)]
struct OsnetShadow {
    model: WinMlModel,
}

#[cfg(windows)]
impl OsnetShadow {
    fn open(path: &Path) -> Result<Self, NativeVisionError> {
        let model = WinMlModel::create_multi(VisionModel::ReId, path, &["output"])?;
        Ok(Self { model })
    }

    fn embed_person(
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

#[cfg(windows)]
impl GeneralizationShadowRunner {
    pub fn open(
        config: GeneralizationShadowConfig,
        transnet_path: &Path,
        osnet_path: &Path,
        vinet_path: &Path,
    ) -> Self {
        let transnet = config
            .transnet
            .then(|| transnet_path.is_file())
            .and_then(|ready| {
                if ready {
                    TransNetShadow::open(transnet_path).ok()
                } else {
                    None
                }
            });
        let osnet_ready = config.osnet
            && osnet_path.is_file()
            && WinMlModel::create_multi(VisionModel::ReId, osnet_path, &["output"]).is_ok();
        let osnet = config
            .osnet
            .then(|| osnet_path.is_file())
            .and_then(|ready| {
                if ready {
                    OsnetShadow::open(osnet_path).ok()
                } else {
                    None
                }
            });
        let vinet_ready = config.vinet
            && vinet_path.is_file()
            && WinMlModel::create_multi(VisionModel::ViNet, vinet_path, &["saliency"]).is_ok();
        let vinet = config
            .vinet
            .then(|| vinet_path.is_file())
            .and_then(|ready| {
                if ready {
                    ViNetShadow::open(vinet_path).ok()
                } else {
                    None
                }
            });
        Self {
            config,
            transnet,
            vinet,
            osnet,
            osnet_ready,
            vinet_ready,
            saliency_proxy: Vec::new(),
            latest_saliency: None,
            reid_triggers: 0,
            reid_samples: Vec::new(),
            prev_gray: None,
            last_frame: None,
        }
    }

    pub fn latest_saliency(&self) -> Option<&SaliencyShadowSample> {
        self.latest_saliency.as_ref()
    }

    fn store_frame_thumb(&mut self, time: f64, rgb: &[u8], width: usize, height: usize) {
        const THUMB_W: usize = 96;
        const THUMB_H: usize = 54;
        let mut thumb = vec![0u8; THUMB_W * THUMB_H * 3];
        for y in 0..THUMB_H {
            let src_y = y * height / THUMB_H;
            for x in 0..THUMB_W {
                let src_x = x * width / THUMB_W;
                let src_index = (src_y * width + src_x) * 3;
                let dst_index = (y * THUMB_W + x) * 3;
                if src_index + 2 < rgb.len() {
                    thumb[dst_index..dst_index + 3].copy_from_slice(&rgb[src_index..src_index + 3]);
                }
            }
        }
        self.last_frame = Some((time, thumb, THUMB_W, THUMB_H));
    }

    pub fn push_frame(
        &mut self,
        rgb: &[u8],
        width: usize,
        height: usize,
        time: f64,
        scene_cut: bool,
        _motion_saliency: Option<(NormalizedBox, f32)>,
        _person_count: usize,
    ) -> bool {
        let mut transnet_cut = false;
        if let Some(transnet) = self.transnet.as_mut() {
            transnet_cut = transnet.push_frame(rgb, width, height, time, scene_cut);
        }
        self.store_frame_thumb(time, rgb, width, height);
        if self.config.vinet {
            let sample = if let Some(vinet) = self.vinet.as_mut() {
                vinet.push_frame(rgb, width, height, time)
            } else if let Some((box_, confidence)) = self.motion_saliency_from_rgb(rgb, width, height) {
                Some(SaliencyShadowSample {
                    time,
                    box_,
                    confidence,
                    kind: "video-saliency-proxy",
                })
            } else {
                None
            };
            if let Some(sample) = sample {
                self.saliency_proxy.push(sample.clone());
                self.latest_saliency = Some(sample);
            }
        }
        transnet_cut
    }

    fn motion_saliency_from_rgb(
        &mut self,
        rgb: &[u8],
        width: usize,
        height: usize,
    ) -> Option<(NormalizedBox, f32)> {
        const GRID_W: usize = 24;
        const GRID_H: usize = 14;
        let mut gray = vec![0u8; GRID_W * GRID_H];
        for gy in 0..GRID_H {
            let src_y = gy * height / GRID_H;
            for gx in 0..GRID_W {
                let src_x = gx * width / GRID_W;
                let index = (src_y * width + src_x) * 3;
                if index + 2 < rgb.len() {
                    gray[gy * GRID_W + gx] = ((rgb[index] as u16
                        + rgb[index + 1] as u16
                        + rgb[index + 2] as u16)
                        / 3) as u8;
                }
            }
        }
        let Some(previous) = self.prev_gray.take() else {
            self.prev_gray = Some(gray);
            return None;
        };
        let mut best_score = 0u32;
        let mut best_cell = 0usize;
        for cell in 0..(GRID_W * GRID_H) {
            let diff = previous[cell].abs_diff(gray[cell]) as u32;
            if diff > best_score {
                best_score = diff;
                best_cell = cell;
            }
        }
        self.prev_gray = Some(gray);
        if best_score < 8 {
            return None;
        }
        let gx = best_cell % GRID_W;
        let gy = best_cell / GRID_W;
        let cell_w = 1.0 / GRID_W as f32;
        let cell_h = 1.0 / GRID_H as f32;
        Some((
            NormalizedBox {
                x: gx as f32 * cell_w,
                y: gy as f32 * cell_h,
                width: cell_w,
                height: cell_h,
            },
            (best_score as f32 / 255.0).clamp(0.0, 1.0),
        ))
    }

    pub fn record_reid_context(
        &mut self,
        time: f64,
        person_count: usize,
        person_box: Option<NormalizedBox>,
    ) -> Option<Vec<f32>> {
        if !self.config.osnet || person_count < 2 {
            return None;
        }
        self.reid_triggers += 1;
        let Some(osnet) = self.osnet.as_mut() else {
            return None;
        };
        let Some((stored_time, rgb, width, height)) = self.last_frame.as_ref() else {
            return None;
        };
        if (stored_time - time).abs() > 0.25 {
            return None;
        }
        let Some(box_) = person_box else {
            return None;
        };
        let Ok(embedding) = osnet.embed_person(rgb, *width, *height, box_) else {
            return None;
        };
        let norm = embedding.iter().map(|value| value * value).sum::<f32>().sqrt();
        self.reid_samples.push(ReIdShadowSample {
            time,
            person_count,
            embedding_dim: embedding.len(),
            embedding_norm: norm,
        });
        Some(embedding)
    }

    pub fn finish(self) -> Option<GeneralizationShadowDiagnostics> {
        if !self.config.any_enabled() {
            return None;
        }
        let mut enabled_models = Vec::new();
        let transnet_samples = if let Some(transnet) = self.transnet {
            enabled_models.push("transnetv2");
            transnet.finish()
        } else if self.config.transnet {
            Vec::new()
        } else {
            Vec::new()
        };
        if self.config.osnet {
            enabled_models.push("osnet-x0.25");
        }
        if self.config.vinet {
            enabled_models.push("vinet-s");
        }
        if enabled_models.is_empty() {
            return None;
        }
        let transnet_calibration = self
            .config
            .transnet
            .then(|| calibrate_transnet_vs_histogram(&transnet_samples));
        let mut saliency_proxy_samples = self.saliency_proxy;
        if let Some(vinet) = self.vinet {
            saliency_proxy_samples.extend(vinet.finish());
        }
        Some(GeneralizationShadowDiagnostics {
            enabled_models,
            transnet_samples,
            transnet_calibration,
            saliency_proxy_samples,
            reid_samples: self.reid_samples,
            osnet_ready: self.config.osnet.then_some(self.osnet_ready),
            reid_trigger_count: self.config.osnet.then_some(self.reid_triggers),
            vinet_ready: self.config.vinet.then_some(self.vinet_ready),
            vinet_note: if self.config.vinet && !self.vinet_ready {
                Some("ViNet shadow requested but ONNX session failed to open.")
            } else {
                None
            },
        })
    }
}

#[cfg(not(windows))]
pub struct GeneralizationShadowRunner;

#[cfg(not(windows))]
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
        _person_box: Option<crate::video_processing::vision_logic::NormalizedBox>,
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
        _motion_saliency: Option<(
            crate::video_processing::vision_logic::NormalizedBox,
            f32,
        )>,
        _person_count: usize,
    ) -> bool {
        false
    }

    pub fn finish(self) -> Option<GeneralizationShadowDiagnostics> {
        None
    }
}

fn resize_rgb_crop_to_reid(
    rgb: &[u8],
    width: usize,
    height: usize,
    box_: NormalizedBox,
    output: &mut [f32],
) {
    let left = (box_.x * width as f32).clamp(0.0, width as f32 - 1.0) as usize;
    let top = (box_.y * height as f32).clamp(0.0, height as f32 - 1.0) as usize;
    let right = ((box_.x + box_.width) * width as f32).clamp(0.0, width as f32) as usize;
    let bottom = ((box_.y + box_.height) * height as f32).clamp(0.0, height as f32) as usize;
    let crop_w = (right - left).max(1);
    let crop_h = (bottom - top).max(1);
    let plane = REID_HEIGHT * REID_WIDTH;
    for y in 0..REID_HEIGHT {
        let src_y = top + y * crop_h / REID_HEIGHT;
        for x in 0..REID_WIDTH {
            let src_x = left + x * crop_w / REID_WIDTH;
            let src_index = (src_y * width + src_x) * 3;
            let dst_index = y * REID_WIDTH + x;
            if src_index + 2 < rgb.len() && dst_index + plane * 2 < output.len() {
                output[dst_index] = rgb[src_index] as f32 / 255.0;
                output[plane + dst_index] = rgb[src_index + 1] as f32 / 255.0;
                output[plane * 2 + dst_index] = rgb[src_index + 2] as f32 / 255.0;
            }
        }
    }
}

fn resize_rgb_to_vinet_frame(rgb: &[u8], width: usize, height: usize, output: &mut [f32]) {
    debug_assert_eq!(output.len(), VINET_PLANE);
    for y in 0..VINET_HEIGHT {
        let src_y = y * height / VINET_HEIGHT;
        for x in 0..VINET_WIDTH {
            let src_x = x * width / VINET_WIDTH;
            let src_index = (src_y * width + src_x) * 3;
            let dst_index = y * VINET_WIDTH + x;
            if src_index + 2 < rgb.len() {
                output[dst_index] = rgb[src_index] as f32 / 255.0;
                output[plane_offset(1) + dst_index] = rgb[src_index + 1] as f32 / 255.0;
                output[plane_offset(2) + dst_index] = rgb[src_index + 2] as f32 / 255.0;
            }
        }
    }
}

fn plane_offset(channel: usize) -> usize {
    channel * VINET_HEIGHT * VINET_WIDTH
}

fn saliency_map_to_box(map: &[f32], width: usize, height: usize) -> (NormalizedBox, f32) {
    let cells = width * height;
    if map.len() < cells {
        return (
            NormalizedBox {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            },
            0.0,
        );
    }
    let plane = &map[..cells];
    let max_value = plane.iter().copied().fold(0.0f32, f32::max);
    if max_value <= 1e-6 {
        return (
            NormalizedBox {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            },
            0.0,
        );
    }
    let threshold = max_value * 0.5;
    let mut weighted_x = 0.0f32;
    let mut weighted_y = 0.0f32;
    let mut weight_sum = 0.0f32;
    let mut min_x = width;
    let mut max_x = 0usize;
    let mut min_y = height;
    let mut max_y = 0usize;
    for y in 0..height {
        for x in 0..width {
            let value = plane[y * width + x];
            if value < threshold {
                continue;
            }
            weighted_x += x as f32 * value;
            weighted_y += y as f32 * value;
            weight_sum += value;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
    }
    if weight_sum <= 1e-6 {
        let peak = plane
            .iter()
            .enumerate()
            .max_by(|left, right| left.1.total_cmp(right.1))
            .map(|(index, _)| index)
            .unwrap_or(0);
        let peak_x = (peak % width) as f32 / width as f32;
        let peak_y = (peak / width) as f32 / height as f32;
        return (
            NormalizedBox {
                x: (peak_x - 0.125).clamp(0.0, 0.75),
                y: (peak_y - 0.125).clamp(0.0, 0.75),
                width: 0.25,
                height: 0.25,
            },
            max_value.clamp(0.0, 1.0),
        );
    }
    let center_x = weighted_x / weight_sum / width as f32;
    let center_y = weighted_y / weight_sum / height as f32;
    let span_x = ((max_x + 1 - min_x) as f32 / width as f32).clamp(0.12, 0.9);
    let span_y = ((max_y + 1 - min_y) as f32 / height as f32).clamp(0.12, 0.9);
    (
        NormalizedBox {
            x: (center_x - span_x * 0.5).clamp(0.0, 1.0 - span_x),
            y: (center_y - span_y * 0.5).clamp(0.0, 1.0 - span_y),
            width: span_x,
            height: span_y,
        },
        (weight_sum / (cells as f32 * max_value)).clamp(0.0, 1.0),
    )
}

fn resize_rgb_to_transnet(rgb: &[u8], width: usize, height: usize, output: &mut Vec<f32>) {
    let start = output.len();
    output.resize(start + TRANSNET_HEIGHT * TRANSNET_WIDTH * 3, 0.0);
    let slice = &mut output[start..];
    for y in 0..TRANSNET_HEIGHT {
        let src_y = y * height / TRANSNET_HEIGHT;
        for x in 0..TRANSNET_WIDTH {
            let src_x = x * width / TRANSNET_WIDTH;
            let src_index = (src_y * width + src_x) * 3;
            let dst_index = (y * TRANSNET_WIDTH + x) * 3;
            if src_index + 2 < rgb.len() {
                slice[dst_index] = rgb[src_index] as f32 / 255.0;
                slice[dst_index + 1] = rgb[src_index + 1] as f32 / 255.0;
                slice[dst_index + 2] = rgb[src_index + 2] as f32 / 255.0;
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shadow_config_default_struct_is_disabled() {
        let config = GeneralizationShadowConfig::default();
        assert!(!config.any_enabled());
    }

    #[test]
    fn shadow_config_resolve_defaults_all_off() {
        let config = GeneralizationShadowConfig::resolve();
        assert!(!config.transnet && !config.osnet && !config.vinet);
    }

    #[test]
    fn resize_rgb_to_transnet_writes_normalized_pixels() {
        let rgb = vec![255u8, 0, 0, 0, 255, 0];
        let mut output = Vec::new();
        resize_rgb_to_transnet(&rgb, 2, 1, &mut output);
        assert_eq!(output.len(), TRANSNET_HEIGHT * TRANSNET_WIDTH * 3);
        assert!((output[0] - 1.0).abs() < 1e-6);
        assert!(output[1].abs() < 1e-6);
    }

    #[test]
    fn calibrate_transnet_vs_histogram_counts_agreement() {
        let samples = vec![
            TransNetShadowSample {
                time: 1.0,
                single_frame_probability: 0.1,
                many_frame_probability: 0.8,
                histogram_scene_cut: false,
            },
            TransNetShadowSample {
                time: 2.0,
                single_frame_probability: 0.1,
                many_frame_probability: 0.2,
                histogram_scene_cut: false,
            },
        ];
        let calibration = calibrate_transnet_vs_histogram(&samples);
        assert_eq!(calibration.sample_count, 2);
        assert_eq!(calibration.transnet_cut_count, 1);
        assert_eq!(calibration.histogram_cut_count, 0);
        assert!((calibration.agreement_rate - 0.5).abs() < 1e-6);
    }

    #[test]
    fn resize_rgb_crop_to_reid_writes_nchw_planes() {
        use crate::video_processing::vision_logic::NormalizedBox;

        let rgb = vec![255u8, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
        let mut output = vec![0.0f32; 3 * REID_HEIGHT * REID_WIDTH];
        resize_rgb_crop_to_reid(
            &rgb,
            2,
            2,
            NormalizedBox {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            &mut output,
        );
        assert!((output[0] - 1.0).abs() < 1e-6);
        assert!((output[REID_HEIGHT * REID_WIDTH] - 0.0).abs() < 1e-6);
    }

    #[test]
    fn saliency_map_to_box_uses_weighted_extent() {
        let mut map = vec![0.0f32; VINET_WIDTH * VINET_HEIGHT];
        map[VINET_WIDTH * 40 + 120] = 1.0;
        map[VINET_WIDTH * 41 + 121] = 0.8;
        let (box_, confidence) = saliency_map_to_box(&map, VINET_WIDTH, VINET_HEIGHT);
        assert!(confidence > 0.0);
        assert!(box_.width > 0.0 && box_.height > 0.0);
        assert!(box_.x >= 0.0 && box_.y >= 0.0);
        let _ = box_;
    }
}
