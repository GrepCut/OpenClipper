use crate::video::caption_gpu::scene::{
    CaptionActiveEffect, CaptionEntrance, CaptionScene, CaptionSceneGroup, CaptionSceneWord,
};

pub fn clamp_progress(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

pub fn caption_progress(timestamp: f64, start: f64, end: f64) -> f64 {
    if end <= start {
        return if timestamp >= end { 1.0 } else { 0.0 };
    }
    clamp_progress((timestamp - start) / (end - start))
}

pub fn caption_entrance_progress(timestamp: f64, start: f64, duration_sec: f64) -> f64 {
    if duration_sec <= 0.0 {
        return if timestamp >= start { 1.0 } else { 0.0 };
    }
    clamp_progress((timestamp - start) / duration_sec)
}

pub fn ease_out_cubic(progress: f64) -> f64 {
    let p = progress.clamp(0.0, 1.0);
    1.0 - (1.0 - p).powi(3)
}

pub fn ease_out_back(progress: f64) -> f64 {
    let overshoot = 1.70158;
    let p = progress.clamp(0.0, 1.0);
    let shifted = p - 1.0;
    1.0 + (overshoot + 1.0) * shifted.powi(3) + overshoot * shifted.powi(2)
}

#[derive(Debug, Clone, Copy)]
pub struct WordMotion {
    pub opacity: f64,
    pub scale: f64,
    pub blur_em: f64,
    pub translate_y_em: f64,
}

pub fn group_entrance_alpha(scene: &CaptionScene, group: &CaptionSceneGroup, timestamp: f64) -> f64 {
    match scene.entrance {
        CaptionEntrance::PageFade | CaptionEntrance::GroupFade => ease_out_cubic(
            caption_entrance_progress(timestamp, group.start, scene.entrance_duration_sec),
        ),
        _ => 1.0,
    }
}

pub fn word_motion(scene: &CaptionScene, word: &CaptionSceneWord, timestamp: f64) -> WordMotion {
    match scene.entrance {
        CaptionEntrance::WordBlur | CaptionEntrance::WordScale | CaptionEntrance::WordRise => {
            let raw = caption_entrance_progress(timestamp, word.start, scene.entrance_duration_sec);
            let progress = ease_out_cubic(raw);
            WordMotion {
                opacity: progress,
                scale: scene.entrance_scale_from + (1.0 - scene.entrance_scale_from) * progress,
                blur_em: scene.entrance_blur_em * (1.0 - progress),
                translate_y_em: if matches!(scene.entrance, CaptionEntrance::WordRise) {
                    0.32 * (1.0 - progress)
                } else {
                    0.0
                },
            }
        }
        _ => WordMotion {
            opacity: 1.0,
            scale: 1.0,
            blur_em: 0.0,
            translate_y_em: 0.0,
        },
    }
}

pub fn active_overlay_alpha(
    scene: &CaptionScene,
    word: &CaptionSceneWord,
    active: bool,
    timestamp: f64,
) -> f64 {
    let duration = scene.active_transition_sec;
    if duration <= 0.0 {
        return if active { 1.0 } else { 0.0 };
    }
    if active {
        return ease_out_cubic(caption_entrance_progress(
            timestamp,
            word.start,
            duration,
        ));
    }
    if timestamp >= word.end && timestamp < word.end + duration {
        return 1.0
            - ease_out_cubic(caption_entrance_progress(timestamp, word.end, duration));
    }
    0.0
}

pub fn active_effect_progress(scene: &CaptionScene, word: &CaptionSceneWord, active: bool, timestamp: f64) -> f64 {
    if !active {
        return 0.0;
    }
    match scene.active_effect {
        CaptionActiveEffect::BeastPop | CaptionActiveEffect::Pop => ease_out_back(
            caption_entrance_progress(timestamp, word.start, scene.active_transition_sec),
        ),
        _ => active_overlay_alpha(scene, word, active, timestamp),
    }
}

pub fn find_active_word_index(words: &[CaptionSceneWord], timestamp: f64) -> isize {
    words
        .iter()
        .position(|word| timestamp >= word.start && timestamp < word.end)
        .map(|i| i as isize)
        .unwrap_or(-1)
}

pub fn find_active_group<'a>(
    scene: &'a CaptionScene,
    timestamp: f64,
) -> Option<(&'a CaptionSceneGroup, isize)> {
    for group in &scene.groups {
        if timestamp >= group.start && timestamp < group.end {
            let active = find_active_word_index(&group.words, timestamp);
            return Some((group, active));
        }
    }
    None
}

pub fn karaoke_fill_progress(word: &CaptionSceneWord, timestamp: f64) -> f64 {
    caption_progress(timestamp, word.start, word.end)
}
