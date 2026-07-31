use crate::video::caption_gpu::animate::{
    active_effect_progress, active_overlay_alpha, find_active_group, find_active_word_index,
    group_entrance_alpha, karaoke_fill_progress, word_motion, WordMotion,
};
use crate::video::caption_gpu::fonts::{attrs_for_scene, make_font_system};
use crate::video::caption_gpu::layout::{build_caption_layout_for_group, CaptionLayout, WordPlacement};
use crate::video::caption_gpu::scene::{
    CaptionActiveEffect, CaptionPlateStyle, CaptionRendererKind, CaptionScene, CaptionSceneGroup,
};
use crate::video::caption_gpu::style_map::{
    features_for_scene, hustle_outline_width_em, parse_hex_color, text_style_for_word,
};
use image::RgbaImage;
use klyff::cosmic_text::{FontSystem, Metrics};
use klyff::{
    EncoderContext, Features, GlyphColoring, Rect, StyledText, StyledTextBuilder, TextRenderer,
    TextureAtlas, TextureAtlasDescriptor,
};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

const SURFACE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

pub struct CaptionGpuContext {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: TextRenderer,
    font_system: FontSystem,
    features: Features,
}

static GPU_PROBE: OnceLock<bool> = OnceLock::new();

pub fn probe_caption_gpu() -> bool {
    *GPU_PROBE.get_or_init(|| {
        pollster::block_on(async {
            request_device()
                .await
                .map(|(device, queue)| {
                    let _ = TextRenderer::with_styling(Features::STROKE_OUT, &device, SURFACE_FORMAT);
                    let _ = queue;
                    true
                })
                .unwrap_or(false)
        })
    })
}

impl CaptionGpuContext {
    pub fn new(resource_fonts_dir: Option<&Path>) -> Result<Self, String> {
        let (device, queue) =
            pollster::block_on(request_device()).ok_or_else(|| "wgpu device unavailable".to_string())?;
        let features = Features::STROKE_OUT | Features::SHADOW | Features::GLOW_OUT;
        let renderer = TextRenderer::with_styling(features, &device, SURFACE_FORMAT);
        let font_system = make_font_system(resource_fonts_dir);
        Ok(Self {
            device,
            queue,
            renderer,
            font_system,
            features,
        })
    }

    pub fn for_scene(resource_fonts_dir: Option<&Path>, scene: &CaptionScene) -> Result<Self, String> {
        let mut ctx = Self::new(resource_fonts_dir)?;
        ctx.features = features_for_scene(scene);
        ctx.renderer = TextRenderer::with_styling(ctx.features, &ctx.device, SURFACE_FORMAT);
        Ok(ctx)
    }
}

pub fn render_scene_frame(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    timestamp: f64,
) -> Result<Vec<u8>, String> {
    let width = scene.output_width.max(2);
    let height = scene.output_height.max(2);
    let mut base = vec![0u8; (width * height * 4) as usize];

    let Some((group, active_index)) = find_active_group(scene, timestamp) else {
        return Ok(base);
    };

    if matches!(scene.renderer, CaptionRendererKind::OneWord) && active_index < 0 {
        return Ok(base);
    }

    match scene.renderer {
        CaptionRendererKind::Karaoke => {
            render_karaoke_frame(ctx, scene, group, timestamp, width, height, &mut base)?;
        }
        CaptionRendererKind::Kinetic => {
            render_kinetic_frame(ctx, scene, group, active_index, timestamp, width, height, &mut base)?;
        }
        CaptionRendererKind::Podcast => {
            render_podcast_frame(ctx, scene, group, timestamp, width, height, &mut base)?;
        }
        _ => {
            render_phrase_frame(
                ctx,
                scene,
                group,
                active_index,
                timestamp,
                width,
                height,
                &mut base,
            )?;
        }
    }

    Ok(base)
}

fn render_phrase_frame(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    group: &CaptionSceneGroup,
    active_index: isize,
    timestamp: f64,
    width: u32,
    height: u32,
    base: &mut [u8],
) -> Result<(), String> {
    let layout = build_caption_layout_for_group(
        &mut ctx.font_system,
        scene,
        group,
        width as f32,
        height as f32,
    );
    let group_alpha = group_entrance_alpha(scene, group, timestamp) as f32;
    if group_alpha <= 0.0 {
        return Ok(());
    }

    draw_plate(base, width, height, scene, &layout, group_alpha);
    draw_gradient_pills(
        base,
        width,
        height,
        scene,
        &layout,
        group,
        active_index,
        timestamp,
        group_alpha,
    );

    let (texts, transforms) = build_phrase_texts(
        ctx,
        scene,
        group,
        &layout,
        active_index,
        timestamp,
        width,
        height,
        group_alpha,
    )?;
    if texts.is_empty() {
        return Ok(());
    }

    let text_rgba = render_texts_gpu(ctx, &texts, width, height, Some(&transforms))?;
    alpha_composite(base, &text_rgba, width, height);
    Ok(())
}

fn render_karaoke_frame(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    group: &CaptionSceneGroup,
    timestamp: f64,
    width: u32,
    height: u32,
    base: &mut [u8],
) -> Result<(), String> {
    let layout = build_caption_layout_for_group(
        &mut ctx.font_system,
        scene,
        group,
        width as f32,
        height as f32,
    );
    let group_alpha = group_entrance_alpha(scene, group, timestamp) as f32;
    draw_plate(base, width, height, scene, &layout, group_alpha);

    let mut texts = Vec::new();
    let transforms = Vec::new();
    for line in &layout.lines {
        for placement in &line.words {
            let word = &group.words[placement.index];
            let motion = word_motion(scene, word, timestamp);
            if motion.opacity <= 0.0 {
                continue;
            }
            let base_style = text_style_for_word(scene, layout.font_px, false, motion.opacity, false);
            texts.push(build_word_text(
                ctx,
                scene,
                placement,
                layout.font_px,
                base_style,
                width,
                height,
                motion,
                0,
            )?);

            let progress = karaoke_fill_progress(word, timestamp);
            if progress > 0.0 {
                let active_style =
                    text_style_for_word(scene, layout.font_px, true, motion.opacity, true);
                let clip_width = placement.width * progress as f32 + layout.font_px * 0.1;
                texts.push(build_word_text_clipped(
                    ctx,
                    scene,
                    placement,
                    layout.font_px,
                    active_style,
                    width,
                    height,
                    motion,
                    clip_width,
                )?);
            }
        }
    }

    let text_rgba = render_texts_gpu(ctx, &texts, width, height, Some(&transforms))?;
    alpha_composite(base, &text_rgba, width, height);
    Ok(())
}

#[derive(Clone, Copy)]
struct GlyphTransform {
    scale: f32,
    rotation_deg: f32,
    translate_y: f32,
    alpha: f32,
}

fn color_to_rgba8(color: klyff::Color) -> [u8; 4] {
    let c = color.0;
    [
        (c.x * 255.0) as u8,
        (c.y * 255.0) as u8,
        (c.z * 255.0) as u8,
        (c.w * 255.0) as u8,
    ]
}

fn build_phrase_texts(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    group: &CaptionSceneGroup,
    layout: &CaptionLayout,
    active_index: isize,
    timestamp: f64,
    width: u32,
    height: u32,
    group_alpha: f32,
) -> Result<(Vec<StyledText>, Vec<GlyphTransform>), String> {
    let mut texts = Vec::new();
    let mut transforms = Vec::new();

    for line in &layout.lines {
        for placement in &line.words {
            let word = &group.words[placement.index];
            let active = placement.index as isize == active_index;
            let motion = word_motion(scene, word, timestamp);
            if motion.opacity <= 0.0 {
                continue;
            }

            let effect_progress = active_effect_progress(scene, word, active, timestamp);
            let overlay_alpha = active_overlay_alpha(scene, word, active, timestamp);
            let alpha = (motion.opacity * group_alpha as f64) as f32;

            let mut transform = GlyphTransform {
                scale: motion.scale as f32,
                rotation_deg: 0.0,
                translate_y: (motion.translate_y_em * layout.font_px as f64) as f32,
                alpha,
            };

            match scene.active_effect {
                CaptionActiveEffect::BeastPop if active => {
                    transform.scale *=
                        (1.0 + (scene.active_scale - 1.0) * effect_progress) as f32;
                    transform.rotation_deg = (scene.active_rotation_deg * effect_progress) as f32;
                }
                CaptionActiveEffect::Pop if active => {
                    transform.scale *=
                        (1.0 + (scene.active_scale - 1.0) * effect_progress) as f32;
                }
                _ => {}
            }

            let inactive_alpha = if active {
                alpha
            } else {
                (motion.opacity * scene.inactive_opacity * group_alpha as f64) as f32
            };

            let outline_em = if matches!(scene.active_effect, CaptionActiveEffect::Hustle) {
                hustle_outline_width_em(scene, active)
            } else {
                scene.outline_width_em
            };

            let draw_active_only = active
                && matches!(
                    scene.active_effect,
                    CaptionActiveEffect::BeastPop | CaptionActiveEffect::Pop | CaptionActiveEffect::Glow
                );

            if !draw_active_only {
                let mut base_style = text_style_for_word(
                    scene,
                    layout.font_px,
                    active,
                    motion.opacity,
                    false,
                );
                if outline_em != scene.outline_width_em {
                    base_style.stroke_out.width = (outline_em * layout.font_px as f64) as f32;
                }

                texts.push(build_word_text(
                    ctx,
                    scene,
                    placement,
                    layout.font_px,
                    base_style,
                    width,
                    height,
                    motion,
                    texts.len(),
                )?);
                transforms.push(transform);
            }

            let needs_overlay = matches!(
                scene.active_effect,
                CaptionActiveEffect::Color
                    | CaptionActiveEffect::GradientPill
                    | CaptionActiveEffect::LongestColor
            );
            if needs_overlay && overlay_alpha > 0.0 {
                let overlay_style = text_style_for_word(
                    scene,
                    layout.font_px,
                    true,
                    overlay_alpha,
                    true,
                );
                texts.push(build_word_text(
                    ctx,
                    scene,
                    placement,
                    layout.font_px,
                    overlay_style,
                    width,
                    height,
                    motion,
                    texts.len(),
                )?);
                transforms.push(transform);
            } else if draw_active_only {
                let active_style = text_style_for_word(
                    scene,
                    layout.font_px,
                    true,
                    inactive_alpha as f64,
                    true,
                );
                texts.push(build_word_text(
                    ctx,
                    scene,
                    placement,
                    layout.font_px,
                    active_style,
                    width,
                    height,
                    motion,
                    texts.len(),
                )?);
                transforms.push(transform);
            }
        }
    }

    Ok((texts, transforms))
}

fn build_word_text(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    placement: &WordPlacement,
    font_px: f32,
    style: klyff::TextStyle,
    width: u32,
    height: u32,
    motion: WordMotion,
    _text_index: usize,
) -> Result<StyledText, String> {
    build_word_text_clipped(
        ctx,
        scene,
        placement,
        font_px,
        style,
        width,
        height,
        motion,
        placement.width + font_px * 0.2,
    )
}

fn build_word_text_clipped(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    placement: &WordPlacement,
    font_px: f32,
    style: klyff::TextStyle,
    width: u32,
    height: u32,
    motion: WordMotion,
    clip_width: f32,
) -> Result<StyledText, String> {
    let italic = scene.font_style == "italic";
    let attrs = attrs_for_scene(scene.font_weight, italic, &scene.font_family);
    let line_height = font_px * scene.line_height_ratio as f32;
    let pad = font_px * 0.15;
    let rect = Rect::from_xywh(
        placement.x - pad,
        placement.y_baseline - font_px * 1.1,
        clip_width + pad * 2.0,
        font_px * 1.35,
    );
    let mut builder = StyledTextBuilder::new(
        rect,
        &mut ctx.font_system,
        Metrics::new(font_px * motion.scale as f32, line_height * motion.scale as f32),
    );
    builder.push_text(&placement.text, &attrs, style);
    let text = builder.finish(&mut ctx.font_system, &attrs);
    let _ = (width, height);
    Ok(text)
}

fn render_kinetic_frame(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    group: &CaptionSceneGroup,
    _active_index: isize,
    timestamp: f64,
    width: u32,
    height: u32,
    base: &mut [u8],
) -> Result<(), String> {
    // Simplified kinetic: render as phrase with secondary font sizing on side words.
    render_phrase_frame(ctx, scene, group, -1, timestamp, width, height, base)
}

fn render_podcast_frame(
    ctx: &mut CaptionGpuContext,
    scene: &CaptionScene,
    group: &CaptionSceneGroup,
    timestamp: f64,
    width: u32,
    height: u32,
    base: &mut [u8],
) -> Result<(), String> {
    let split_at = (group.words.len() + 1) / 2;
    let active_index = find_active_word_index(&group.words, timestamp);
    let first_line = &group.words[..split_at];
    let second_line = &group.words[split_at..];
    let mut y_offset = 0.0f32;
    for (line_index, line_words) in [first_line, second_line].into_iter().enumerate() {
        if line_words.is_empty() {
            continue;
        }
        let sub_group = CaptionSceneGroup {
            start: group.start,
            end: group.end,
            words: line_words.to_vec(),
        };
        let mut line_scene = scene.clone();
        if line_index == 1 {
            line_scene.anchor_y = scene.anchor_y + 0.06;
        }
        let mut line_base = vec![0u8; base.len()];
        render_phrase_frame(
            ctx,
            &line_scene,
            &sub_group,
            active_index,
            timestamp,
            width,
            height,
            &mut line_base,
        )?;
        for (dst, src) in base.iter_mut().zip(line_base.iter()) {
            if *src > *dst {
                *dst = *src;
            }
        }
        y_offset += 1.0;
        let _ = y_offset;
    }
    Ok(())
}

fn draw_plate(
    base: &mut [u8],
    width: u32,
    height: u32,
    scene: &CaptionScene,
    layout: &CaptionLayout,
    alpha: f32,
) {
    if !matches!(scene.plate_style, CaptionPlateStyle::Group) {
        return;
    }
    let pad_x = layout.font_px * scene.plate_padding_x_em as f32;
    let pad_y = layout.font_px * scene.plate_padding_y_em as f32;
    let radius = layout.font_px * scene.plate_radius_em as f32;
    let plate_w = layout.max_line_width + pad_x * 2.0;
    let plate_h = layout.bottom - layout.top + pad_y * 2.0;
    let x0 = width as f32 / 2.0 - plate_w / 2.0;
    let y0 = layout.top - pad_y;
    let color = parse_hex_color(&scene.plate_color, (scene.plate_opacity * alpha as f64) as f32);
    fill_rounded_rect(base, width, height, x0, y0, plate_w, plate_h, radius, color);
}

fn draw_gradient_pills(
    base: &mut [u8],
    width: u32,
    height: u32,
    scene: &CaptionScene,
    layout: &CaptionLayout,
    group: &CaptionSceneGroup,
    active_index: isize,
    timestamp: f64,
    group_alpha: f32,
) {
    if !matches!(scene.active_effect, CaptionActiveEffect::GradientPill) {
        return;
    }
    let Some(gradient) = scene.active_gradient.as_ref() else {
        return;
    };
    for line in &layout.lines {
        for placement in &line.words {
            if placement.index as isize != active_index {
                continue;
            }
            let word = &group.words[placement.index];
            let alpha = (active_overlay_alpha(scene, word, true, timestamp) * group_alpha as f64) as f32;
            if alpha <= 0.0 {
                continue;
            }
            let pad_x = layout.font_px * scene.active_padding_x_em as f32;
            let pad_y = layout.font_px * scene.active_padding_y_em as f32;
            let x = placement.x - pad_x;
            let y = placement.y_baseline - layout.font_px * 0.91 - pad_y;
            let w = placement.width + pad_x * 2.0;
            let h = layout.font_px * 1.08 + pad_y * 2.0;
            let radius = layout.font_px * scene.active_radius_em as f32;
            let top = parse_hex_color(&gradient.from, alpha);
            let bottom = parse_hex_color(&gradient.to, alpha);
            fill_vertical_gradient_rounded_rect(
                base, width, height, x, y, w, h, radius, top, bottom,
            );
        }
    }
}

fn fill_rounded_rect(
    base: &mut [u8],
    width: u32,
    height: u32,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    radius: f32,
    color: klyff::Color,
) {
    let r = radius.min(w * 0.5).min(h * 0.5);
    let x0 = x.floor().max(0.0) as i32;
    let y0 = y.floor().max(0.0) as i32;
    let x1 = (x + w).ceil().min(width as f32) as i32;
    let y1 = (y + h).ceil().min(height as f32) as i32;
    let rgba = color_to_rgba8(color);
    for py in y0..y1 {
        for px in x0..x1 {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            if inside_rounded_rect(fx, fy, x, y, w, h, r) {
                blend_pixel(base, width, height, px as u32, py as u32, rgba);
            }
        }
    }
}

fn fill_vertical_gradient_rounded_rect(
    base: &mut [u8],
    width: u32,
    height: u32,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    radius: f32,
    top: klyff::Color,
    bottom: klyff::Color,
) {
    let r = radius.min(w * 0.5).min(h * 0.5);
    let x0 = x.floor().max(0.0) as i32;
    let y0 = y.floor().max(0.0) as i32;
    let x1 = (x + w).ceil().min(width as f32) as i32;
    let y1 = (y + h).ceil().min(height as f32) as i32;
    for py in y0..y1 {
        let t = ((py as f32 - y) / h.max(1.0)).clamp(0.0, 1.0);
        let color = lerp_color(top, bottom, t);
        let rgba = color_to_rgba8(color);
        for px in x0..x1 {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            if inside_rounded_rect(fx, fy, x, y, w, h, r) {
                blend_pixel(base, width, height, px as u32, py as u32, rgba);
            }
        }
    }
}

fn inside_rounded_rect(px: f32, py: f32, x: f32, y: f32, w: f32, h: f32, r: f32) -> bool {
    if px < x || py < y || px > x + w || py > y + h {
        return false;
    }
    if r <= 0.0 {
        return true;
    }
    let corners = [
        (x + r, y + r),
        (x + w - r, y + r),
        (x + r, y + h - r),
        (x + w - r, y + h - r),
    ];
    for (cx, cy) in corners {
        if (px < x + r && py < y + r && (px - cx).hypot(py - cy) > r)
            || (px > x + w - r && py < y + r && (px - cx).hypot(py - cy) > r)
            || (px < x + r && py > y + h - r && (px - cx).hypot(py - cy) > r)
            || (px > x + w - r && py > y + h - r && (px - cx).hypot(py - cy) > r)
        {
            return false;
        }
    }
    true
}

fn lerp_color(a: klyff::Color, b: klyff::Color, t: f32) -> klyff::Color {
    let a = a.0;
    let b = b.0;
    klyff::Color::from_rgba(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
        a.w + (b.w - a.w) * t,
    )
}

fn blend_pixel(base: &mut [u8], width: u32, height: u32, x: u32, y: u32, rgba: [u8; 4]) {
    if x >= width || y >= height {
        return;
    }
    let idx = ((y * width + x) * 4) as usize;
    let src_a = rgba[3] as f32 / 255.0;
    if src_a <= 0.0 {
        return;
    }
    let dst_a = base[idx + 3] as f32 / 255.0;
    let out_a = src_a + dst_a * (1.0 - src_a);
    if out_a <= 0.0 {
        return;
    }
    for c in 0..3 {
        let src = rgba[c] as f32 / 255.0;
        let dst = base[idx + c] as f32 / 255.0;
        let out = (src * src_a + dst * dst_a * (1.0 - src_a)) / out_a;
        base[idx + c] = (out * 255.0).round() as u8;
    }
    base[idx + 3] = (out_a * 255.0).round() as u8;
}

fn alpha_composite(dst: &mut [u8], src: &[u8], width: u32, height: u32) {
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            blend_pixel(dst, width, height, x, y, [
                src[idx],
                src[idx + 1],
                src[idx + 2],
                src[idx + 3],
            ]);
        }
    }
}

fn render_texts_gpu(
    ctx: &mut CaptionGpuContext,
    texts: &[StyledText],
    width: u32,
    height: u32,
    transforms: Option<&[GlyphTransform]>,
) -> Result<Vec<u8>, String> {
    let mut atlas = TextureAtlas::new(&ctx.device, TextureAtlasDescriptor::default());
    let target = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("caption target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: SURFACE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());

    let mut encoder = ctx
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());

    if let Some(transforms) = transforms {
        ctx.renderer.prepare_with_glyph_transform(
            EncoderContext {
                atlas: &mut atlas,
                device: &ctx.device,
                queue: &ctx.queue,
                cmd_encoder: &mut encoder,
                font_system: &mut ctx.font_system,
            },
            (width, height),
            texts,
            |glyph, positions| {
                let text_id = glyph.text_id as usize;
                if let Some(t) = transforms.get(text_id) {
                    let scale = t.scale.max(0.01);
                    let angle = t.rotation_deg.to_radians();
                    let (sin, cos) = angle.sin_cos();
                    for pos in positions {
                        let center = *pos;
                        let offset = glam::vec2(0.0, t.translate_y);
                        let scaled = (*pos - center) * scale + center + offset;
                        let rel = scaled - center;
                        *pos = center + glam::vec2(
                            rel.x * cos - rel.y * sin,
                            rel.x * sin + rel.y * cos,
                        );
                    }
                }
            },
            |glyph, style| {
                if let Some(t) = transforms.get(glyph.text_id as usize) {
                    if let GlyphColoring::Solid(color) = style.color {
                        let c = color.0;
                        style.color = GlyphColoring::Solid(klyff::Color::from_rgba(
                            c.x,
                            c.y,
                            c.z,
                            c.w * t.alpha,
                        ));
                    }
                }
            },
        );
    } else {
        ctx.renderer.prepare(
            EncoderContext {
                atlas: &mut atlas,
                device: &ctx.device,
                queue: &ctx.queue,
                cmd_encoder: &mut encoder,
                font_system: &mut ctx.font_system,
            },
            (width, height),
            texts,
        );
    }

    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("caption pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });
        ctx.renderer.render(&mut pass, &atlas);
    }

    read_texture_rgba(&ctx.device, &ctx.queue, encoder, &target, width, height)
}

fn read_texture_rgba(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    mut encoder: wgpu::CommandEncoder,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let bytes_per_pixel = 4u32;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let unpadded = width * bytes_per_pixel;
    let padded = unpadded.div_ceil(align) * align;
    let buffer_size = padded as u64 * height as u64;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("caption readback"),
        size: buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(encoder.finish()));

    let slice = buffer.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |res| {
        let _ = sender.send(res);
    });
    let _ = device.poll(wgpu::PollType::Wait {
        submission_index: None,
        timeout: None,
    });
    receiver
        .recv()
        .map_err(|_| "GPU readback channel closed".to_string())?
        .map_err(|e| format!("GPU map failed: {e:?}"))?;

    let mapped = slice.get_mapped_range();
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for row in 0..height as usize {
        let src_start = row * padded as usize;
        let dst_start = row * width as usize * 4;
        rgba[dst_start..dst_start + width as usize * 4]
            .copy_from_slice(&mapped[src_start..src_start + width as usize * 4]);
    }
    drop(mapped);
    buffer.unmap();
    Ok(rgba)
}

async fn request_device() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok()?;
    adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await
        .ok()
}

pub fn save_png(path: &Path, rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let image = RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| "Invalid RGBA buffer".to_string())?;
    image.save(path).map_err(|e| e.to_string())
}

pub fn resource_fonts_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource = app.path().resource_dir().ok()?;
    let bundled = resource.join("fonts");
    if bundled.is_dir() {
        return Some(bundled);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/fonts");
    if dev.is_dir() {
        return Some(dev);
    }
    None
}
