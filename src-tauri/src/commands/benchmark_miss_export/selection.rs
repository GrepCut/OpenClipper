use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

use crate::repository::test_repository::TestKeyframeDto;

use super::types::{
    BenchmarkFrameDetail, BenchmarkTargetDetail, RankedFrame, SampledKeyframeFrame,
    VISIBILITY_MISS_BASE,
};

fn target_score(target: &BenchmarkTargetDetail) -> f64 {
    if !target.coverage_hit {
        VISIBILITY_MISS_BASE + (1.0 - target.coverage_fraction)
    } else {
        1.0 - target.coverage_fraction
    }
}

fn frame_score(detail: &BenchmarkFrameDetail) -> f64 {
    detail
        .targets
        .iter()
        .map(target_score)
        .fold(0.0, f64::max)
}

pub(crate) fn select_worst_half(sampled: Vec<SampledKeyframeFrame>) -> Vec<RankedFrame> {
    if sampled.is_empty() {
        return Vec::new();
    }
    let mut ranked: Vec<RankedFrame> = sampled
        .into_iter()
        .map(|sample| {
            let score = frame_score(&sample.detail);
            RankedFrame {
                detail: sample.detail,
                score,
                keyframe_timestamp_us: sample.keyframe_timestamp_us,
            }
        })
        .collect();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let take = ((ranked.len() as f64) * 0.5).ceil() as usize;
    ranked.truncate(take.max(1));
    ranked
}

fn stable_sample_key(seed: &str, keyframe_timestamp_us: i64) -> u64 {
    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    keyframe_timestamp_us.hash(&mut hasher);
    hasher.finish()
}

pub(crate) fn subsample_random_half_of_worst(
    ranked: Vec<RankedFrame>,
    original_count: usize,
    seed: &str,
) -> Vec<RankedFrame> {
    if ranked.is_empty() {
        return ranked;
    }
    let target = ((original_count as f64) * 0.25).ceil() as usize;
    let target = target.max(1);
    if ranked.len() <= target {
        return ranked;
    }
    let mut keyed: Vec<_> = ranked
        .into_iter()
        .map(|frame| (stable_sample_key(seed, frame.keyframe_timestamp_us), frame))
        .collect();
    keyed.sort_by_key(|(key, _)| *key);
    let mut selected: Vec<RankedFrame> = keyed
        .into_iter()
        .take(target)
        .map(|(_, frame)| frame)
        .collect();
    selected.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    selected
}

pub(crate) fn select_frames_for_export(
    sampled: Vec<SampledKeyframeFrame>,
    seed: &str,
) -> Vec<RankedFrame> {
    let original_count = sampled.len();
    let worst_half = select_worst_half(sampled);
    subsample_random_half_of_worst(worst_half, original_count, seed)
}

pub(crate) fn sample_frames_at_keyframes(
    frames: &[BenchmarkFrameDetail],
    keyframes: &[TestKeyframeDto],
) -> Result<Vec<SampledKeyframeFrame>, String> {
    if keyframes.is_empty() {
        return Err("This clip has no annotated keyframes to sample.".into());
    }
    if frames.is_empty() {
        return Err("Benchmark details contain no frames.".into());
    }
    let mut sampled = Vec::with_capacity(keyframes.len());
    for keyframe in keyframes {
        let nearest = frames
            .iter()
            .min_by_key(|frame| (frame.timestamp_us - keyframe.timestamp_us).unsigned_abs())
            .expect("frames checked");
        if sampled
            .iter()
            .any(|sample: &SampledKeyframeFrame| {
                sample.detail.timestamp_us == nearest.timestamp_us
            })
        {
            continue;
        }
        sampled.push(SampledKeyframeFrame {
            keyframe_timestamp_us: keyframe.timestamp_us,
            detail: nearest.clone(),
        });
    }
    if sampled.is_empty() {
        return Err("No benchmark frames matched the annotated keyframes.".into());
    }
    Ok(sampled)
}

pub(crate) fn read_frame_details(path: &Path) -> Result<Vec<BenchmarkFrameDetail>, String> {
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(|error| error.to_string()))
        .collect()
}
