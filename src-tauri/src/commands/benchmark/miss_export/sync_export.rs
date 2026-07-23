use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;
use tauri::AppHandle;

use crate::commands::benchmark::test_dataset_root;
use crate::video::ffmpeg::frames::extract_frame_rgb_at_timestamp;

use super::annotate::{annotate_frame, encode_rgb_jpeg};
use super::ground_truth::evaluate_ground_truth;
use super::selection::{read_frame_details, sample_frames_at_keyframes, select_frames_for_export};
use super::types::{
    BenchmarkFrameDetail, ExportInput, ExportManifest, ExportSyncResult, ManifestFrame,
    ManifestTarget,
};

pub(crate) fn run_export_dir(
    app: &AppHandle,
    dataset_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    Ok(test_dataset_root(app, dataset_id)?
        .join("miss-frames")
        .join(run_id))
}

pub(crate) fn export_file_prefix(clip_id: &str, aspect_id: &str) -> String {
    format!("{clip_id}_{aspect_id}_")
}

fn remove_prefixed_exports(
    export_dir: &Path,
    clip_id: &str,
    aspect_id: &str,
) -> Result<(), String> {
    if !export_dir.is_dir() {
        return Ok(());
    }
    let prefix = export_file_prefix(clip_id, aspect_id);
    for entry in fs::read_dir(export_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with(&prefix) {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    let sidecar = export_dir.join(format!("{prefix}manifest.json"));
    if sidecar.is_file() {
        fs::remove_file(sidecar).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn export_filename(
    clip_id: &str,
    aspect_id: &str,
    rank: usize,
    detail: &BenchmarkFrameDetail,
) -> String {
    let min_coverage = detail
        .targets
        .iter()
        .map(|target| target.coverage_fraction)
        .fold(1.0, f64::min);
    let covered = if detail.all_targets_covered { 1 } else { 0 };
    format!(
        "{}_{}_rank{:03}_t{}ms_cov{:.2}_hit{}.jpg",
        clip_id,
        aspect_id,
        rank,
        detail.timestamp_us / 1_000,
        min_coverage,
        covered
    )
}

pub(crate) fn export_benchmark_miss_frames_sync(
    app: &AppHandle,
    input: ExportInput,
    replace_existing: bool,
) -> Result<ExportSyncResult, String> {
    let dataset_root = test_dataset_root(app, &input.dataset_id)?;
    let details_path = dataset_root.join(&input.details_relative_path);
    if !details_path.is_file() {
        return Err("Benchmark details file is missing on disk.".into());
    }
    let video_path = dataset_root.join(&input.media_relative_path);
    if !video_path.is_file() {
        return Err("Stored test video is missing.".into());
    }
    let all_frames = read_frame_details(&details_path)?;
    let sampled = sample_frames_at_keyframes(&all_frames, &input.keyframes)?;
    let ranked = select_frames_for_export(sampled, &input.run_id);
    let export_dir = input.export_dir.clone();
    if replace_existing {
        remove_prefixed_exports(&export_dir, &input.clip_id, &input.aspect_id)?;
    }
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let mut manifest_frames = Vec::with_capacity(ranked.len());
    for (index, ranked_frame) in ranked.iter().enumerate() {
        let rank = index + 1;
        let timestamp_sec = ranked_frame.keyframe_timestamp_us as f64 / 1_000_000.0;
        let extracted = extract_frame_rgb_at_timestamp(&video_path, timestamp_sec)?;
        let ground_truth =
            evaluate_ground_truth(&input.keyframes, ranked_frame.keyframe_timestamp_us);
        let annotated = annotate_frame(
            extracted.rgb,
            extracted.width,
            extracted.height,
            &ranked_frame.detail,
            &ground_truth,
        );
        let file_name =
            export_filename(&input.clip_id, &input.aspect_id, rank, &ranked_frame.detail);
        fs::write(
            export_dir.join(&file_name),
            encode_rgb_jpeg(&annotated, extracted.width, extracted.height)?,
        )
        .map_err(|error| error.to_string())?;
        manifest_frames.push(ManifestFrame {
            clip_id: input.clip_id.clone(),
            aspect_id: input.aspect_id.clone(),
            rank,
            file: file_name,
            keyframe_timestamp_us: ranked_frame.keyframe_timestamp_us,
            timestamp_us: ranked_frame.detail.timestamp_us,
            timestamp_sec,
            score: ranked_frame.score,
            all_targets_covered: ranked_frame.detail.all_targets_covered,
            targets: ranked_frame
                .detail
                .targets
                .iter()
                .map(|target| ManifestTarget {
                    slot: target.slot,
                    coverage_fraction: target.coverage_fraction,
                    coverage_hit: target.coverage_hit,
                })
                .collect(),
            viewports: ranked_frame.detail.viewports.clone(),
        });
    }
    let manifest = ExportManifest {
        run_id: input.run_id.clone(),
        clip_id: input.clip_id.clone(),
        aspect_id: input.aspect_id.clone(),
        exported_at: Utc::now().to_rfc3339(),
        selection: "worst-50-percent-then-random-25-percent",
        keyframe_count: input.keyframes.len(),
        frame_count: manifest_frames.len(),
        frames: manifest_frames.clone(),
    };
    Ok(ExportSyncResult {
        frame_count: manifest.frame_count,
        manifest,
    })
}

pub(crate) fn write_manifest_file(
    export_dir: &Path,
    file_name: &str,
    manifest: &impl Serialize,
) -> Result<String, String> {
    let manifest_path = export_dir.join(file_name);
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

pub(crate) fn manifest_relative_path(
    dataset_root: &Path,
    manifest_path: &Path,
) -> Result<String, String> {
    Ok(manifest_path
        .strip_prefix(dataset_root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}
