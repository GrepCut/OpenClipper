use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use chrono::Utc;
use image::{codecs::jpeg::JpegEncoder, ExtendedColorType};
use sea_orm::EntityTrait;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::database::LocalDb;
use crate::entity::{benchmark_result, benchmark_run, test_clip};
use crate::repository::test_repository::{TestKeyframeDto, TestTargetDto};
use crate::repository::TestRepository;
use crate::video_processing::extract_frame_rgb_at_timestamp;

use super::{test_dataset_root, validate_id};

const VISIBILITY_MISS_BASE: f64 = 10_000.0;
const CROP_VIEWPORT_RGB: [u8; 3] = [255, 68, 68];
const CROP_VIEWPORT_OUTLINE_RGB: [u8; 3] = [0, 0, 0];
const CROP_VIEWPORT_BORDER_PX: i32 = 3;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedViewport {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkTargetDetail {
    slot: i32,
    visible: bool,
    focus_hit: bool,
    focus_error_radius: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkFrameDetail {
    timestamp_us: i64,
    all_targets_visible: bool,
    viewports: Vec<NormalizedViewport>,
    targets: Vec<BenchmarkTargetDetail>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ManifestTarget {
    slot: i32,
    visible: bool,
    focus_hit: bool,
    focus_error_radius: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFrame {
    clip_id: String,
    aspect_id: String,
    rank: usize,
    file: String,
    keyframe_timestamp_us: i64,
    timestamp_us: i64,
    timestamp_sec: f64,
    score: f64,
    all_targets_visible: bool,
    targets: Vec<ManifestTarget>,
    viewports: Vec<NormalizedViewport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportManifest {
    run_id: String,
    clip_id: String,
    aspect_id: String,
    exported_at: String,
    selection: &'static str,
    keyframe_count: usize,
    frame_count: usize,
    frames: Vec<ManifestFrame>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunExportManifest {
    run_id: String,
    exported_at: String,
    selection: &'static str,
    result_count: usize,
    frame_count: usize,
    frames: Vec<ManifestFrame>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBenchmarkMissFramesResult {
    pub export_dir: String,
    pub frame_count: usize,
    pub manifest_relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBenchmarkRunMissFramesResult {
    pub export_dir: String,
    pub frame_count: usize,
    pub result_count: usize,
}

#[derive(Clone)]
struct RankedFrame {
    detail: BenchmarkFrameDetail,
    score: f64,
    keyframe_timestamp_us: i64,
}

struct SampledKeyframeFrame {
    keyframe_timestamp_us: i64,
    detail: BenchmarkFrameDetail,
}

struct ExportInput {
    dataset_id: String,
    run_id: String,
    clip_id: String,
    aspect_id: String,
    details_relative_path: String,
    media_relative_path: String,
    keyframes: Vec<TestKeyframeDto>,
    export_dir: PathBuf,
}

struct ExportSyncResult {
    frame_count: usize,
    manifest: ExportManifest,
}

fn run_export_dir(app: &AppHandle, dataset_id: &str, run_id: &str) -> Result<PathBuf, String> {
    Ok(test_dataset_root(app, dataset_id)?
        .join("miss-frames")
        .join(run_id))
}

fn export_file_prefix(clip_id: &str, aspect_id: &str) -> String {
    format!("{clip_id}_{aspect_id}_")
}

fn remove_prefixed_exports(export_dir: &Path, clip_id: &str, aspect_id: &str) -> Result<(), String> {
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

fn target_score(target: &BenchmarkTargetDetail) -> f64 {
    if !target.visible {
        VISIBILITY_MISS_BASE + target.focus_error_radius
    } else {
        target.focus_error_radius
    }
}

fn frame_score(detail: &BenchmarkFrameDetail) -> f64 {
    detail
        .targets
        .iter()
        .map(target_score)
        .fold(0.0, f64::max)
}

fn select_worst_half(sampled: Vec<SampledKeyframeFrame>) -> Vec<RankedFrame> {
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

fn subsample_random_half_of_worst(
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

fn select_frames_for_export(sampled: Vec<SampledKeyframeFrame>, seed: &str) -> Vec<RankedFrame> {
    let original_count = sampled.len();
    let worst_half = select_worst_half(sampled);
    subsample_random_half_of_worst(worst_half, original_count, seed)
}

fn sample_frames_at_keyframes(
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

fn clone_target(target: &TestTargetDto) -> TestTargetDto {
    TestTargetDto {
        id: target.id.clone(),
        slot: target.slot,
        x: target.x,
        y: target.y,
        radius: target.radius,
    }
}

fn evaluate_ground_truth(keyframes: &[TestKeyframeDto], timestamp_us: i64) -> Vec<TestTargetDto> {
    if keyframes.is_empty() {
        return Vec::new();
    }
    if timestamp_us <= keyframes[0].timestamp_us {
        return keyframes[0].targets.iter().map(clone_target).collect();
    }
    let last = keyframes.last().expect("keyframes checked");
    if timestamp_us >= last.timestamp_us {
        return last.targets.iter().map(clone_target).collect();
    }
    let mut next_index = 1usize;
    while next_index < keyframes.len() && keyframes[next_index].timestamp_us < timestamp_us {
        next_index += 1;
    }
    let next = &keyframes[next_index];
    if next.timestamp_us == timestamp_us {
        return next.targets.iter().map(clone_target).collect();
    }
    let previous = &keyframes[next_index - 1];
    let factor = (timestamp_us - previous.timestamp_us) as f64
        / (next.timestamp_us - previous.timestamp_us).max(1) as f64;
    previous
        .targets
        .iter()
        .map(|target| {
            let target_next = next.targets.iter().find(|candidate| candidate.slot == target.slot);
            match target_next {
                Some(next_target) => TestTargetDto {
                    id: target.id.clone(),
                    slot: target.slot,
                    x: target.x + (next_target.x - target.x) * factor,
                    y: target.y + (next_target.y - target.y) * factor,
                    radius: target.radius + (next_target.radius - target.radius) * factor,
                },
                None => clone_target(target),
            }
        })
        .collect()
}

fn set_pixel(rgb: &mut [u8], width: u32, height: u32, x: i32, y: i32, color: [u8; 3]) {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return;
    }
    let index = (y as u32 * width + x as u32) as usize * 3;
    if index + 2 >= rgb.len() {
        return;
    }
    rgb[index] = color[0];
    rgb[index + 1] = color[1];
    rgb[index + 2] = color[2];
}

fn draw_rect_border(
    rgb: &mut [u8],
    width: u32,
    height: u32,
    x0: f64,
    y0: f64,
    w: f64,
    h: f64,
    color: [u8; 3],
    thickness: i32,
) {
    if thickness <= 0 {
        return;
    }
    let left = (x0 * width as f64).round() as i32;
    let top = (y0 * height as f64).round() as i32;
    let right = ((x0 + w) * width as f64).round() as i32;
    let bottom = ((y0 + h) * height as f64).round() as i32;
    for t in 0..thickness {
        let inset_top = top + t;
        let inset_bottom = bottom - t;
        let inset_left = left + t;
        let inset_right = right - t;
        if inset_top > inset_bottom || inset_left > inset_right {
            break;
        }
        for x in inset_left..=inset_right {
            set_pixel(rgb, width, height, x, inset_top, color);
            set_pixel(rgb, width, height, x, inset_bottom, color);
        }
        for y in inset_top..=inset_bottom {
            set_pixel(rgb, width, height, inset_left, y, color);
            set_pixel(rgb, width, height, inset_right, y, color);
        }
    }
}

fn draw_crop_viewport_border(
    rgb: &mut [u8],
    width: u32,
    height: u32,
    viewport: &NormalizedViewport,
) {
    draw_rect_border(
        rgb,
        width,
        height,
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
        CROP_VIEWPORT_OUTLINE_RGB,
        CROP_VIEWPORT_BORDER_PX + 2,
    );
    draw_rect_border(
        rgb,
        width,
        height,
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
        CROP_VIEWPORT_RGB,
        CROP_VIEWPORT_BORDER_PX,
    );
}

fn draw_circle_border(rgb: &mut [u8], width: u32, height: u32, cx: f64, cy: f64, radius: f64, color: [u8; 3]) {
    let short_side = width.min(height) as f64;
    let pixel_radius = radius * short_side;
    let center_x = cx * width as f64;
    let center_y = cy * height as f64;
    let steps = ((pixel_radius * 2.0 * std::f64::consts::PI).max(32.0)) as usize;
    for step in 0..steps {
        let angle = step as f64 / steps as f64 * std::f64::consts::TAU;
        let ring_x = center_x + angle.cos() * pixel_radius;
        let ring_y = center_y + angle.sin() * pixel_radius;
        for dx in -1..=1 {
            for dy in -1..=1 {
                set_pixel(
                    rgb,
                    width,
                    height,
                    (ring_x + dx as f64).round() as i32,
                    (ring_y + dy as f64).round() as i32,
                    color,
                );
            }
        }
    }
}

fn slot_color(slot: i32) -> [u8; 3] {
    if slot == 1 { [244, 114, 182] } else { [34, 211, 238] }
}

fn annotate_frame(
    mut rgb: Vec<u8>,
    width: u32,
    height: u32,
    detail: &BenchmarkFrameDetail,
    ground_truth: &[TestTargetDto],
) -> Vec<u8> {
    for viewport in &detail.viewports {
        draw_crop_viewport_border(&mut rgb, width, height, viewport);
    }
    for target in ground_truth {
        draw_circle_border(&mut rgb, width, height, target.x, target.y, target.radius, slot_color(target.slot));
    }
    rgb
}

fn encode_rgb_jpeg(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 88)
        .encode(rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|error| format!("JPEG encode error: {error}"))?;
    Ok(jpeg)
}

fn read_frame_details(path: &Path) -> Result<Vec<BenchmarkFrameDetail>, String> {
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(|error| error.to_string()))
        .collect()
}

fn export_filename(clip_id: &str, aspect_id: &str, rank: usize, detail: &BenchmarkFrameDetail) -> String {
    let max_error = detail
        .targets
        .iter()
        .map(|target| target.focus_error_radius)
        .fold(0.0, f64::max);
    let vis = if detail.all_targets_visible { 1 } else { 0 };
    format!(
        "{}_{}_rank{:03}_t{}ms_err{:.2}_vis{}.jpg",
        clip_id,
        aspect_id,
        rank,
        detail.timestamp_us / 1_000,
        max_error,
        vis
    )
}

fn export_benchmark_miss_frames_sync(
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
        let ground_truth = evaluate_ground_truth(&input.keyframes, ranked_frame.keyframe_timestamp_us);
        let annotated = annotate_frame(
            extracted.rgb,
            extracted.width,
            extracted.height,
            &ranked_frame.detail,
            &ground_truth,
        );
        let file_name = export_filename(&input.clip_id, &input.aspect_id, rank, &ranked_frame.detail);
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
            all_targets_visible: ranked_frame.detail.all_targets_visible,
            targets: ranked_frame
                .detail
                .targets
                .iter()
                .map(|target| ManifestTarget {
                    slot: target.slot,
                    visible: target.visible,
                    focus_hit: target.focus_hit,
                    focus_error_radius: target.focus_error_radius,
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

fn write_manifest_file(
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

fn manifest_relative_path(dataset_root: &Path, manifest_path: &Path) -> Result<String, String> {
    Ok(manifest_path
        .strip_prefix(dataset_root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub async fn export_benchmark_miss_frames(
    app: AppHandle,
    db: State<'_, LocalDb>,
    result_id: String,
) -> Result<ExportBenchmarkMissFramesResult, String> {
    validate_id(&result_id)?;
    let result = benchmark_result::Entity::find_by_id(result_id.clone())
        .one(&db.database)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Benchmark result was not found.".to_string())?;
    if result.status != "completed" {
        return Err("Only completed benchmark results can export frames.".into());
    }
    let details_relative_path = result
        .details_relative_path
        .clone()
        .ok_or_else(|| "This benchmark result has no per-frame details.".to_string())?;
    let run = benchmark_run::Entity::find_by_id(result.run_id.clone())
        .one(&db.database)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Benchmark run was not found.".to_string())?;
    let clip = test_clip::Entity::find_by_id(result.clip_id.clone())
        .one(&db.database)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Test clip was not found.".to_string())?;
    let keyframes = TestRepository::annotations(&db.database, &clip.id)
        .await
        .map_err(String::from)?;
    let dataset_id = run.dataset_id.clone();
    let export_dir = run_export_dir(&app, &dataset_id, &run.id)?;
    let input = ExportInput {
        dataset_id: dataset_id.clone(),
        run_id: run.id,
        clip_id: clip.id,
        aspect_id: result.aspect_id,
        details_relative_path,
        media_relative_path: clip.media_relative_path,
        keyframes,
        export_dir: export_dir.clone(),
    };
    let export = tokio::task::spawn_blocking({
        let app = app.clone();
        move || export_benchmark_miss_frames_sync(&app, input, true)
    })
    .await
    .map_err(|error| error.to_string())??;
    let sidecar_name = format!(
        "{}manifest.json",
        export_file_prefix(&export.manifest.clip_id, &export.manifest.aspect_id)
    );
    let manifest_path = write_manifest_file(&export_dir, &sidecar_name, &export.manifest)?;
    let dataset_root = test_dataset_root(&app, &dataset_id)?;
    Ok(ExportBenchmarkMissFramesResult {
        export_dir: export_dir.to_string_lossy().into_owned(),
        frame_count: export.frame_count,
        manifest_relative_path: manifest_relative_path(&dataset_root, Path::new(&manifest_path))?,
    })
}

pub async fn export_benchmark_run_miss_frames_inner(
    app: &AppHandle,
    db: &sea_orm::DatabaseConnection,
    run_id: &str,
    output_dir: Option<PathBuf>,
) -> Result<ExportBenchmarkRunMissFramesResult, String> {
    validate_id(run_id)?;
    let run = benchmark_run::Entity::find_by_id(run_id.to_string())
        .one(db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Benchmark run was not found.".to_string())?;
    if run.status != "completed" {
        return Err("Only completed benchmark runs can export frames.".into());
    }
    let results = TestRepository::list_results(db, run_id)
        .await
        .map_err(String::from)?;
    let exportable: Vec<_> = results
        .into_iter()
        .filter(|result| {
            result.status == "completed" && result.details_relative_path.is_some()
        })
        .collect();
    if exportable.is_empty() {
        return Err("This run has no completed results with per-frame details.".into());
    }
    let export_dir = match output_dir {
        Some(path) => path,
        None => run_export_dir(app, &run.dataset_id, run_id)?,
    };
    if export_dir.exists() {
        fs::remove_dir_all(&export_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let mut frame_count = 0usize;
    let mut all_frames = Vec::new();
    for result in &exportable {
        let details_relative_path = result
            .details_relative_path
            .clone()
            .expect("filtered");
        let clip = test_clip::Entity::find_by_id(result.clip_id.clone())
            .one(db)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Test clip was not found.".to_string())?;
        let keyframes = TestRepository::annotations(db, &clip.id)
            .await
            .map_err(String::from)?;
        let input = ExportInput {
            dataset_id: run.dataset_id.clone(),
            run_id: run.id.clone(),
            clip_id: clip.id,
            aspect_id: result.aspect_id.clone(),
            details_relative_path,
            media_relative_path: clip.media_relative_path,
            keyframes,
            export_dir: export_dir.clone(),
        };
        let export = tokio::task::spawn_blocking({
            let app = app.clone();
            move || export_benchmark_miss_frames_sync(&app, input, false)
        })
        .await
        .map_err(|error| error.to_string())??;
        frame_count += export.frame_count;
        all_frames.extend(export.manifest.frames);
    }
    let run_manifest = RunExportManifest {
        run_id: run_id.to_string(),
        exported_at: Utc::now().to_rfc3339(),
        selection: "worst-50-percent-then-random-25-percent",
        result_count: exportable.len(),
        frame_count,
        frames: all_frames,
    };
    write_manifest_file(&export_dir, "manifest.json", &run_manifest)?;
    Ok(ExportBenchmarkRunMissFramesResult {
        export_dir: export_dir.to_string_lossy().into_owned(),
        frame_count,
        result_count: exportable.len(),
    })
}

#[tauri::command]
pub async fn export_benchmark_run_miss_frames(
    app: AppHandle,
    db: State<'_, LocalDb>,
    run_id: String,
) -> Result<ExportBenchmarkRunMissFramesResult, String> {
    export_benchmark_run_miss_frames_inner(&app, &db.database, &run_id, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_at(timestamp_us: i64, visible: bool, error: f64) -> BenchmarkFrameDetail {
        BenchmarkFrameDetail {
            timestamp_us,
            all_targets_visible: visible,
            viewports: Vec::new(),
            targets: vec![BenchmarkTargetDetail {
                slot: 0,
                visible,
                focus_hit: error <= 1.0,
                focus_error_radius: error,
            }],
        }
    }

    fn keyframe_at(timestamp_us: i64) -> TestKeyframeDto {
        TestKeyframeDto {
            id: format!("kf-{timestamp_us}"),
            timestamp_us,
            targets: Vec::new(),
        }
    }

    #[test]
    fn samples_one_nearest_frame_per_keyframe() {
        let frames = vec![
            frame_at(1_000_000, true, 1.0),
            frame_at(2_000_000, true, 2.0),
            frame_at(3_000_000, false, 5.0),
        ];
        let keyframes = vec![keyframe_at(1_050_000), keyframe_at(2_900_000)];
        let sampled = sample_frames_at_keyframes(&frames, &keyframes).expect("sample");
        assert_eq!(sampled.len(), 2);
        assert_eq!(sampled[0].detail.timestamp_us, 1_000_000);
        assert_eq!(sampled[1].detail.timestamp_us, 3_000_000);
    }

    #[test]
    fn ranks_invisible_keyframe_samples_first() {
        let sampled = vec![
            SampledKeyframeFrame {
                keyframe_timestamp_us: 1_000_000,
                detail: frame_at(1_000_000, true, 2.0),
            },
            SampledKeyframeFrame {
                keyframe_timestamp_us: 2_000_000,
                detail: frame_at(2_000_000, false, 1.0),
            },
            SampledKeyframeFrame {
                keyframe_timestamp_us: 3_000_000,
                detail: frame_at(3_000_000, true, 1.0),
            },
            SampledKeyframeFrame {
                keyframe_timestamp_us: 4_000_000,
                detail: frame_at(4_000_000, true, 3.0),
            },
        ];
        let ranked = select_worst_half(sampled);
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].detail.timestamp_us, 2_000_000);
        assert_eq!(ranked[1].detail.timestamp_us, 4_000_000);
    }

    #[test]
    fn subsamples_worst_half_down_to_quarter_of_original() {
        let worst_half: Vec<RankedFrame> = (1..=8)
            .map(|index| RankedFrame {
                keyframe_timestamp_us: index * 1_000_000,
                score: index as f64,
                detail: frame_at(index * 1_000_000, true, index as f64),
            })
            .collect();
        let subsampled = subsample_random_half_of_worst(worst_half, 8, "run-seed");
        assert_eq!(subsampled.len(), 2);
        assert_eq!(subsampled[0].keyframe_timestamp_us, 8_000_000);
        assert_eq!(subsampled[1].keyframe_timestamp_us, 3_000_000);
    }

    #[test]
    fn subsample_is_deterministic_for_same_seed() {
        let worst_half: Vec<RankedFrame> = (1..=8)
            .map(|index| RankedFrame {
                keyframe_timestamp_us: index * 1_000_000,
                score: index as f64,
                detail: frame_at(index * 1_000_000, true, index as f64),
            })
            .collect();
        let first = subsample_random_half_of_worst(worst_half.clone(), 8, "run-seed");
        let second = subsample_random_half_of_worst(worst_half, 8, "run-seed");
        assert_eq!(
            first
                .iter()
                .map(|frame| frame.keyframe_timestamp_us)
                .collect::<Vec<_>>(),
            second
                .iter()
                .map(|frame| frame.keyframe_timestamp_us)
                .collect::<Vec<_>>(),
        );
    }

    #[test]
    fn single_keyframe_exports_one_frame() {
        let sampled = vec![SampledKeyframeFrame {
            keyframe_timestamp_us: 1_000_000,
            detail: frame_at(1_000_000, false, 5.0),
        }];
        let ranked = select_frames_for_export(sampled, "run-seed");
        assert_eq!(ranked.len(), 1);
    }
}
