use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sea_orm::EntityTrait;
use tauri::AppHandle;

use crate::commands::benchmark::{test_dataset_root, validate_id};
use crate::storage::entity::{benchmark_result, benchmark_run, test_clip};
use crate::storage::repository::TestRepository;

use super::sync_export::{
    export_benchmark_miss_frames_sync, export_file_prefix, manifest_relative_path, run_export_dir,
    write_manifest_file,
};
use super::types::{
    ExportBenchmarkMissFramesResult, ExportBenchmarkRunMissFramesResult, ExportInput,
    RunExportManifest,
};

pub async fn export_benchmark_miss_frames(
    app: AppHandle,
    db: &sea_orm::DatabaseConnection,
    result_id: String,
) -> Result<ExportBenchmarkMissFramesResult, String> {
    validate_id(&result_id)?;
    let result = benchmark_result::Entity::find_by_id(result_id.clone())
        .one(db)
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
        .one(db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Benchmark run was not found.".to_string())?;
    let clip = test_clip::Entity::find_by_id(result.clip_id.clone())
        .one(db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Test clip was not found.".to_string())?;
    let keyframes = TestRepository::annotations(db, &clip.id)
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
        .filter(|result| result.status == "completed" && result.details_relative_path.is_some())
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
        let details_relative_path = result.details_relative_path.clone().expect("filtered");
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
