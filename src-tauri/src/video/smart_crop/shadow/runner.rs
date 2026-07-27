use std::path::Path;

use super::calibrate_transnet_vs_histogram;
use super::osnet::OsnetShadow;
use super::transnet::TransNetShadow;
use super::types::{
    GeneralizationShadowConfig, GeneralizationShadowDiagnostics, ReIdShadowSample,
    SaliencyShadowSample,
};
use super::vinet::ViNetShadow;
use crate::video::smart_crop::vision::{VisionModel, WinMlModel};
use crate::video::smart_crop::vision_logic::NormalizedBox;

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
    ) -> Option<f64> {
        let mut transnet_cut = None;
        if let Some(transnet) = self.transnet.as_mut() {
            transnet_cut = transnet.push_frame(rgb, width, height, time, scene_cut);
        }
        // The thumbnail exists solely for deferred OSNet ReID.  In the normal
        // production configuration every shadow model is disabled, so copying
        // it on every analysis sample was pure allocation/copy work.
        if self.config.osnet {
            self.store_frame_thumb(time, rgb, width, height);
        }
        if self.config.vinet {
            let sample = if let Some(vinet) = self.vinet.as_mut() {
                vinet.push_frame(rgb, width, height, time)
            } else if let Some((box_, confidence)) =
                self.motion_saliency_from_rgb(rgb, width, height)
            {
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
                    gray[gy * GRID_W + gx] =
                        ((rgb[index] as u16 + rgb[index + 1] as u16 + rgb[index + 2] as u16) / 3)
                            as u8;
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
        let norm = embedding
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
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
