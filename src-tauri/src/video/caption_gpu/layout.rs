use crate::video::caption_gpu::fonts::attrs_for_scene;
use crate::video::caption_gpu::scene::{CaptionScene, CaptionSceneGroup, CaptionSceneWord};
use klyff::cosmic_text::{Buffer, FontSystem, Metrics, Shaping};

#[derive(Debug, Clone)]
pub struct WordPlacement {
    pub index: usize,
    pub text: String,
    pub x: f32,
    pub y_baseline: f32,
    pub width: f32,
}

#[derive(Debug, Clone)]
pub struct LineLayout {
    pub width: f32,
    pub words: Vec<WordPlacement>,
}

#[derive(Debug, Clone)]
pub struct CaptionLayout {
    pub font_px: f32,
    pub lines: Vec<LineLayout>,
    pub top: f32,
    pub bottom: f32,
    pub max_line_width: f32,
}

fn caption_word_scale(scene: &CaptionScene) -> f64 {
    scene
        .active_scale
        .max(scene.entrance_scale_from)
        .max(1.0)
}

fn caption_group_scale(scene: &CaptionScene) -> f64 {
    scene.group_scale_to.unwrap_or(1.0).max(1.0)
}

fn caption_horizontal_padding_em(scene: &CaptionScene) -> f64 {
    let text_effect = scene.outline_width_em
        + scene.shadow_blur_em
        + scene.shadow_offset_x_em.abs();
    let plate = if matches!(scene.plate_style, crate::video::caption_gpu::scene::CaptionPlateStyle::Group) {
        scene.plate_padding_x_em
    } else {
        0.0
    };
    let active = if matches!(
        scene.active_effect,
        crate::video::caption_gpu::scene::CaptionActiveEffect::GradientPill
    ) {
        scene.active_padding_x_em
    } else {
        0.0
    };
    text_effect.max(plate).max(active)
}

pub fn measure_word_width(
    font_system: &mut FontSystem,
    scene: &CaptionScene,
    text: &str,
    font_px: f32,
    line_height: f32,
) -> f32 {
    let italic = scene.font_style == "italic";
    let attrs = attrs_for_scene(scene.font_weight, italic, &scene.font_family);
    let metrics = Metrics::new(font_px, line_height);
    let mut buffer = Buffer::new(font_system, metrics);
    buffer.set_size(font_system, Some(f32::MAX), Some(line_height));
    buffer.set_text(font_system, text, &attrs, Shaping::Advanced, None);
    buffer.shape_until_scroll(font_system, false);

    let mut width = 0.0f32;
    let line_count = buffer.lines.len();
    for line_i in 0..line_count {
        if let Some(layout) = buffer.line_layout(font_system, line_i) {
            for layout_line in layout {
                for glyph in layout_line.glyphs.iter() {
                    width += glyph.w;
                }
            }
        }
    }
    width + (scene.letter_spacing_em * font_px as f64) as f32 * text.chars().count() as f32
}

fn fit_font_px(
    font_system: &mut FontSystem,
    scene: &CaptionScene,
    visible_texts: &[String],
    width: f32,
    height: f32,
) -> f32 {
    let base = (height * scene.font_size_ratio as f32).max(12.0).round();
    let line_height = base * scene.line_height_ratio as f32;
    let longest = visible_texts
        .iter()
        .map(|text| measure_word_width(font_system, scene, text, base, line_height))
        .fold(0.0f32, f32::max);
    if longest <= 0.0 {
        return base;
    }
    let painted = longest * caption_word_scale(scene) as f32
        + base * caption_horizontal_padding_em(scene) as f32 * 2.0;
    let available = (width * scene.max_width_ratio as f32) / caption_group_scale(scene) as f32;
    if painted <= available {
        return base;
    }
    ((base * available) / painted).floor().max(1.0)
}

fn layout_words_into_lines(
    font_system: &mut FontSystem,
    scene: &CaptionScene,
    visible_texts: &[String],
    max_width: f32,
    word_gap: f32,
    font_px: f32,
    line_height: f32,
) -> Vec<Vec<usize>> {
    let mut lines: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut current_width = 0.0f32;

    for (index, text) in visible_texts.iter().enumerate() {
        let word_width = measure_word_width(font_system, scene, text, font_px, line_height);
        let added = word_width + if current.is_empty() { 0.0 } else { word_gap };
        if !current.is_empty() && current_width + added > max_width {
            lines.push(current);
            current = vec![index];
            current_width = word_width;
        } else {
            current.push(index);
            current_width += added;
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

pub fn build_caption_layout(
    font_system: &mut FontSystem,
    scene: &CaptionScene,
    words: &[CaptionSceneWord],
    width: f32,
    height: f32,
) -> CaptionLayout {
    let visible_texts: Vec<String> = words
        .iter()
        .map(|word| {
            if scene.uppercase {
                word.text.to_uppercase()
            } else {
                word.text.clone()
            }
        })
        .collect();

    let font_px = fit_font_px(font_system, scene, &visible_texts, width, height);
    let line_height = font_px * scene.line_height_ratio as f32;
    let word_gap = font_px * scene.word_gap_em as f32;
    let horizontal_padding = font_px * caption_horizontal_padding_em(scene) as f32;
    let max_line_width = ((width * scene.max_width_ratio as f32) / caption_group_scale(scene) as f32
        - horizontal_padding * 2.0)
        .max(1.0);

    let word_lines = layout_words_into_lines(
        font_system,
        scene,
        &visible_texts,
        max_line_width,
        word_gap,
        font_px,
        line_height,
    );

    let total_height = word_lines.len() as f32 * line_height;
    let top = height * scene.anchor_y as f32 - total_height / 2.0;

    let lines: Vec<LineLayout> = word_lines
        .into_iter()
        .enumerate()
        .map(|(line_index, indices)| {
            let widths: Vec<f32> = indices
                .iter()
                .map(|&index| {
                    measure_word_width(
                        font_system,
                        scene,
                        &visible_texts[index],
                        font_px,
                        line_height,
                    )
                })
                .collect();
            let line_width = widths.iter().sum::<f32>()
                + word_gap * (indices.len().saturating_sub(1) as f32);
            let mut x = width / 2.0 - line_width / 2.0;
            let words = indices
                .into_iter()
                .enumerate()
                .map(|(word_index, index)| {
                    let placement = WordPlacement {
                        index,
                        text: visible_texts[index].clone(),
                        x,
                        y_baseline: top + font_px + line_index as f32 * line_height,
                        width: widths[word_index],
                    };
                    x += widths[word_index] + word_gap;
                    placement
                })
                .collect();
            LineLayout {
                width: line_width,
                words,
            }
        })
        .collect();

    let max_line_width = lines
        .iter()
        .map(|line| line.width)
        .fold(0.0f32, f32::max);

    CaptionLayout {
        font_px,
        lines,
        top,
        bottom: top + total_height,
        max_line_width,
    }
}

pub fn build_caption_layout_for_group(
    font_system: &mut FontSystem,
    scene: &CaptionScene,
    group: &CaptionSceneGroup,
    width: f32,
    height: f32,
) -> CaptionLayout {
    build_caption_layout(font_system, scene, &group.words, width, height)
}
