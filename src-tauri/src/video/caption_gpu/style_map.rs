use crate::video::caption_gpu::scene::{CaptionActiveEffect, CaptionScene};
use klyff::{Color, Features, GlyphColoring, Glow, Outline, Shadow, TextStyle};

pub fn parse_hex_color(hex: &str, alpha: f32) -> Color {
    let cleaned = hex.trim().trim_start_matches('#');
    let full = if cleaned.len() == 3 {
        cleaned
            .chars()
            .map(|c| format!("{c}{c}"))
            .collect::<String>()
    } else {
        cleaned.to_string()
    };
    let padded = format!("{:0<6}", full);
    let r = u8::from_str_radix(&padded[0..2], 16).unwrap_or(255) as f32 / 255.0;
    let g = u8::from_str_radix(&padded[2..4], 16).unwrap_or(255) as f32 / 255.0;
    let b = u8::from_str_radix(&padded[4..6], 16).unwrap_or(255) as f32 / 255.0;
    Color::from_rgba(r, g, b, alpha.clamp(0.0, 1.0))
}

pub fn features_for_scene(scene: &CaptionScene) -> Features {
    let mut features = Features::STROKE_OUT | Features::SHADOW;
    if matches!(scene.active_effect, CaptionActiveEffect::Glow) {
        features |= Features::GLOW_OUT;
    }
    features
}

pub fn base_text_style(scene: &CaptionScene, font_px: f32) -> TextStyle {
    let outline_width = (scene.outline_width_em * font_px as f64) as f32;
    let shadow_blur = (scene.shadow_blur_em * font_px as f64 * 0.25) as f32;
    let shadow_x = (scene.shadow_offset_x_em * font_px as f64) as f32;
    let shadow_y = (scene.shadow_offset_y_em * font_px as f64) as f32;

    let mut style = TextStyle {
        color: GlyphColoring::Solid(parse_hex_color(&scene.text_color, 1.0)),
        stroke_out: Outline {
            color: GlyphColoring::Solid(parse_hex_color(&scene.outline_color, 1.0)),
            width: outline_width.max(0.0),
            roundness: 1.0,
        },
        shadow: Shadow {
            color: GlyphColoring::Solid(parse_hex_color(&scene.shadow_color, 0.75)),
            direction: glam::vec2(shadow_x, shadow_y),
            additional_width: shadow_blur.max(0.0),
            spread: 0.0,
            roundness: 0.0,
        },
        ..Default::default()
    };

    if matches!(scene.active_effect, CaptionActiveEffect::Glow) {
        style.glow_out = Glow {
            color: GlyphColoring::Solid(parse_hex_color(&scene.active_color, 0.85)),
            width: (font_px * 0.28).max(1.0),
            spread: 0.0,
            roundness: 0.5,
        };
    }

    style.clamped_to_msdf_range(font_px)
}

pub fn active_text_style(scene: &CaptionScene, font_px: f32, use_glow: bool) -> TextStyle {
    let mut style = base_text_style(scene, font_px);
    style.color = GlyphColoring::Solid(parse_hex_color(&scene.active_text_color, 1.0));
    if use_glow {
        style.glow_out = Glow {
            color: GlyphColoring::Solid(parse_hex_color(&scene.active_color, 0.85)),
            width: (font_px * 0.28).max(1.0),
            spread: 0.0,
            roundness: 0.5,
        };
    }
    if let Some(outline_em) = scene.active_outline_width_em {
        style.stroke_out.width = (outline_em * font_px as f64) as f32;
    } else {
        style.stroke_out.width = 0.0;
    }
    style.shadow = Shadow::default();
    style.clamped_to_msdf_range(font_px)
}

pub fn text_style_for_word(
    scene: &CaptionScene,
    font_px: f32,
    active: bool,
    overlay_alpha: f64,
    use_active_color: bool,
) -> TextStyle {
    let alpha = overlay_alpha.clamp(0.0, 1.0) as f32;
    let use_glow = active && matches!(scene.active_effect, CaptionActiveEffect::Glow);
    let mut style = if use_active_color {
        active_text_style(scene, font_px, use_glow)
    } else if active && use_glow {
        let mut s = base_text_style(scene, font_px);
        s.color = GlyphColoring::Solid(parse_hex_color(&scene.active_text_color, alpha));
        s.glow_out = Glow {
            color: GlyphColoring::Solid(parse_hex_color(&scene.active_color, 0.85)),
            width: (font_px * 0.28).max(1.0),
            spread: 0.0,
            roundness: 0.5,
        };
        s
    } else {
        let mut s = base_text_style(scene, font_px);
        s.color = GlyphColoring::Solid(parse_hex_color(
            if active && use_active_color {
                &scene.active_text_color
            } else {
                &scene.text_color
            },
            if active && !use_active_color {
                scene.inactive_opacity as f32
            } else {
                alpha
            },
        ));
        s
    };

    if matches!(
        scene.active_effect,
        CaptionActiveEffect::Color
            | CaptionActiveEffect::GradientPill
            | CaptionActiveEffect::LongestColor
    ) && use_active_color
    {
        style.stroke_out.width = 0.0;
        style.shadow = Shadow::default();
    }

    style.clamped_to_msdf_range(font_px)
}

pub fn hustle_outline_width_em(scene: &CaptionScene, active: bool) -> f64 {
    if active {
        scene
            .active_outline_width_em
            .unwrap_or(scene.outline_width_em)
    } else {
        scene.outline_width_em
    }
}
