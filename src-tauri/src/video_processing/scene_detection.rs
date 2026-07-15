use crate::video_processing::histogram::{calculate_luminance_ratio, cosine_similarity};
use crate::video_processing::types::SceneGroup;

const SCENE_COLORS: &[&str] = &[
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#2980b9",
    "#27ae60", "#8e44ad", "#16a085", "#d35400", "#c0392b", "#2c3e50", "#f1c40f", "#7f8c8d",
    "#e84393", "#00cec9", "#6c5ce7", "#fd79a8",
];

fn get_scene_color(index: usize) -> String {
    SCENE_COLORS[index % SCENE_COLORS.len()].to_string()
}

fn percentile(sorted: &[f32], p: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let k = ((sorted.len() - 1) as f32 * p).floor() as usize;
    sorted[k.min(sorted.len() - 1)]
}

fn check_local_spike(i: usize, n: usize, sim_prev: f32, similarities: &[f32]) -> bool {
    if i <= 2 || i + 2 >= n {
        return false;
    }

    let local_avg = (similarities[i - 3]
        + similarities[i - 2]
        + similarities.get(i).copied().unwrap_or(1.0)
        + similarities.get(i + 1).copied().unwrap_or(1.0))
        / 4.0;

    sim_prev < local_avg - 0.15 && sim_prev < 0.90
}

fn compute_consecutive_similarities(histograms: &[[u32; 192]]) -> Vec<f32> {
    histograms
        .windows(2)
        .map(|w| cosine_similarity(&w[0], &w[1]))
        .collect()
}

fn compute_adaptive_thresholds(similarities: &[f32], n: usize) -> (f32, f32) {
    let mut sorted_sims = similarities.to_vec();
    sorted_sims.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let p10 = percentile(&sorted_sims, 0.10);
    let p25 = percentile(&sorted_sims, 0.25);

    let prev_threshold = p10.clamp(0.70, 0.94);
    let drift_threshold = p25.clamp(0.78, 0.95);

    eprintln!(
        "[FFmpeg/SceneDetect] Adaptive thresholds: prev={:.4} drift={:.4} (p10={:.4}, p25={:.4}, n={})",
        prev_threshold, drift_threshold, p10, p25, n
    );

    (prev_threshold, drift_threshold)
}

fn create_initial_single_scene(n: usize) -> Vec<SceneGroup> {
    if n == 1 {
        vec![create_scene_group(0, 0, 0, 1.0)]
    } else {
        Vec::new()
    }
}

fn create_scene_group(
    id: usize,
    start_index: usize,
    end_index: usize,
    similarity: f32,
) -> SceneGroup {
    SceneGroup {
        id,
        start_frame_index: start_index,
        end_frame_index: end_index,
        frame_count: end_index.saturating_sub(start_index) + 1,
        color: get_scene_color(id),
        boundary_similarity: similarity,
        start_time: 0.0,
        end_time: 0.0,
    }
}

pub(crate) fn detect_scenes_adaptive(histograms: &[[u32; 192]]) -> Vec<SceneGroup> {
    let n = histograms.len();
    if n < 2 {
        return create_initial_single_scene(n);
    }

    let similarities = compute_consecutive_similarities(histograms);
    let (prev_threshold, drift_threshold) = compute_adaptive_thresholds(&similarities, n);

    group_scenes(histograms, &similarities, prev_threshold, drift_threshold)
}

fn group_scenes(
    histograms: &[[u32; 192]],
    similarities: &[f32],
    prev_threshold: f32,
    drift_threshold: f32,
) -> Vec<SceneGroup> {
    let n = histograms.len();
    let mut scenes = Vec::new();
    let mut current_start = 0usize;
    let mut rep_idx = 0usize;
    let mut cumulative_drift = 0.0_f32;
    let max_cumulative_drift = 1.8_f32;

    for (i, &sim_prev) in similarities.iter().enumerate().take(n - 1) {
        let current_index = i + 1;
        let sim_rep = cosine_similarity(&histograms[rep_idx], &histograms[current_index]);

        cumulative_drift += 1.0 - sim_prev;

        if is_scene_boundary(
            sim_prev,
            sim_rep,
            cumulative_drift,
            max_cumulative_drift,
            prev_threshold,
            drift_threshold,
            &histograms[current_index - 1],
            &histograms[current_index],
            current_index,
            n,
            similarities,
        ) {
            scenes.push(create_scene_group(
                scenes.len(),
                current_start,
                current_index - 1,
                sim_prev,
            ));

            current_start = current_index;
            rep_idx = current_index;
            cumulative_drift = 0.0;
        }
    }

    scenes.push(create_scene_group(scenes.len(), current_start, n - 1, 1.0));

    scenes
}

fn is_scene_boundary(
    sim_prev: f32,
    sim_rep: f32,
    cumulative_drift: f32,
    max_cumulative_drift: f32,
    prev_threshold: f32,
    drift_threshold: f32,
    hist_prev: &[u32; 192],
    hist_curr: &[u32; 192],
    i: usize,
    n: usize,
    similarities: &[f32],
) -> bool {
    let is_hard_cut = sim_prev < 0.45;
    if is_hard_cut {
        return true;
    }

    let is_below_floor = sim_prev < 0.88;
    if is_below_floor {
        return true;
    }

    let is_local_spike = check_local_spike(i, n, sim_prev, similarities);
    if is_local_spike {
        return true;
    }

    let lum_ratio_a = calculate_luminance_ratio(hist_prev);
    let lum_ratio_b = calculate_luminance_ratio(hist_curr);
    let is_luminance_jump = (lum_ratio_a - lum_ratio_b).abs() > 0.28;

    if is_luminance_jump {
        return true;
    }

    let is_same_scene = sim_prev >= prev_threshold
        && sim_rep >= drift_threshold
        && cumulative_drift < max_cumulative_drift;

    !is_same_scene
}
