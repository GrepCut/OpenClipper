use crate::video::caption_gpu::render_frame::{render_scene_frame, save_png, CaptionGpuContext};
use crate::video::caption_gpu::scene::CaptionScene;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct CaptionOverlaySpec {
    pub dir: PathBuf,
    pub pattern: String,
    pub fps: f64,
    pub frame_count: usize,
}

pub fn render_caption_png_sequence(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    out_dir: &Path,
    duration_sec: f64,
) -> Result<CaptionOverlaySpec, String> {
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let fps = scene.fps.max(1.0);
    let frame_count = (duration_sec.max(0.001) * fps).ceil() as usize;
    let width = scene.output_width.max(2);
    let height = scene.output_height.max(2);

    for frame_index in 0..frame_count {
        let timestamp = frame_index as f64 / fps;
        let rgba = render_scene_frame(ctx, scene, timestamp)?;
        let path = out_dir.join(format!("captions_{frame_index:06}.png"));
        save_png(&path, &rgba, width, height)?;
    }

    Ok(CaptionOverlaySpec {
        dir: out_dir.to_path_buf(),
        pattern: "captions_%06d.png".to_string(),
        fps,
        frame_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::video::caption_gpu::probe_caption_gpu;
    use crate::video::caption_gpu::scene::{
        CaptionActiveEffect, CaptionPlateStyle, CaptionRendererKind, CaptionScene,
        CaptionSceneGroup, CaptionSceneWord,
    };

    fn sample_scene() -> CaptionScene {
        CaptionScene {
            output_width: 540,
            output_height: 960,
            fps: 30.0,
            preset_id: "capicola-box".into(),
            font_family: "Inter".into(),
            font_weight: 800,
            font_style: "normal".into(),
            font_size_ratio: 0.075,
            line_height_ratio: 1.08,
            word_gap_em: 0.22,
            letter_spacing_em: 0.0,
            uppercase: true,
            max_width_ratio: 0.9,
            anchor_y: 0.78,
            text_color: "#FFFFFF".into(),
            active_text_color: "#111111".into(),
            active_color: "#FFE45E".into(),
            outline_color: "#000000".into(),
            outline_width_em: 0.07,
            shadow_color: "#000000".into(),
            shadow_blur_em: 0.1,
            shadow_offset_x_em: 0.03,
            shadow_offset_y_em: 0.03,
            plate_style: CaptionPlateStyle::Group,
            plate_color: "#FFE45E".into(),
            plate_opacity: 1.0,
            plate_radius_em: 0.14,
            plate_padding_x_em: 0.35,
            plate_padding_y_em: 0.16,
            active_effect: CaptionActiveEffect::Color,
            active_gradient: None,
            active_padding_x_em: 0.2,
            active_padding_y_em: 0.1,
            active_radius_em: 0.2,
            active_transition_sec: 0.1,
            active_scale: 1.0,
            active_rotation_deg: 0.0,
            entrance: crate::video::caption_gpu::scene::CaptionEntrance::GroupFade,
            entrance_duration_sec: 0.15,
            entrance_scale_from: 1.0,
            entrance_blur_em: 0.0,
            inactive_opacity: 1.0,
            active_outline_width_em: None,
            group_scale_to: None,
            secondary_font_family: None,
            secondary_font_size_scale: None,
            accent_colors: vec![],
            renderer: CaptionRendererKind::Phrase,
            groups: vec![CaptionSceneGroup {
                start: 0.0,
                end: 1.0,
                words: vec![
                    CaptionSceneWord {
                        text: "Hello".into(),
                        start: 0.0,
                        end: 0.5,
                    },
                    CaptionSceneWord {
                        text: "world".into(),
                        start: 0.5,
                        end: 1.0,
                    },
                ],
            }],
        }
    }

    #[test]
    fn probe_gpu_smoke() {
        if !probe_caption_gpu() {
            eprintln!("Skipping GPU tests — wgpu unavailable");
            return;
        }
        let mut ctx = CaptionGpuContext::new(None).expect("context");
        let scene = sample_scene();
        let rgba = render_scene_frame(&mut ctx, &scene, 0.25).expect("frame");
        assert_eq!(rgba.len(), (scene.output_width * scene.output_height * 4) as usize);
        let alpha_sum: u64 = rgba.chunks(4).map(|px| px[3] as u64).sum();
        assert!(alpha_sum > 0, "expected visible caption pixels");
    }
}
