use std::fs;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use bzip2::{read::BzDecoder, write::BzEncoder, Compression};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::database::LocalDb;
use crate::entity::{benchmark_result, benchmark_run, test_clip, test_dataset, test_keyframe, test_target};
use crate::repository::test_repository::{TestDatasetSummary, TestKeyframeDto};
use crate::repository::TestRepository;
use crate::video_processing::extract_clipper_segment_to_path_blocking;

const TEST_ARCHIVE_SCHEMA_VERSION: u32 = 1;
const MIN_CLIP_SECONDS: f64 = 3.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTestClipInput {
    pub id: String,
    pub dataset_id: String,
    pub name: String,
    pub source_path: String,
    pub original_file_name: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceAnnotationsResult {
    pub annotation_revision: i32,
    pub keyframes: Vec<TestKeyframeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutBenchmarkResultInput {
    pub id: String,
    pub run_id: String,
    pub clip_id: String,
    pub aspect_id: String,
    pub status: String,
    pub metrics: Value,
    pub details_relative_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestArchiveManifest {
    schema_version: u32,
    dataset: test_dataset::Model,
    clips: Vec<test_clip::Model>,
    keyframes: Vec<ArchiveKeyframe>,
    runs: Vec<benchmark_run::Model>,
    results: Vec<benchmark_result::Model>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveKeyframe {
    clip_id: String,
    keyframe: TestKeyframeDto,
}

#[tauri::command]
pub async fn test_dataset_list(db: State<'_, LocalDb>) -> Result<Vec<TestDatasetSummary>, String> {
    TestRepository::list_datasets(&db.database).await.map_err(Into::into)
}

#[tauri::command]
pub async fn test_dataset_get(
    db: State<'_, LocalDb>,
    id: String,
) -> Result<Option<test_dataset::Model>, String> {
    TestRepository::get_dataset(&db.database, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn test_dataset_create(
    db: State<'_, LocalDb>,
    id: String,
    name: String,
    description: Option<String>,
) -> Result<test_dataset::Model, String> {
    validate_id(&id)?;
    TestRepository::create_dataset(&db.database, id, name, description)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_dataset_update(
    db: State<'_, LocalDb>,
    id: String,
    name: String,
    description: Option<String>,
) -> Result<test_dataset::Model, String> {
    TestRepository::update_dataset(&db.database, id, name, description)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_dataset_delete(
    app: AppHandle,
    db: State<'_, LocalDb>,
    id: String,
) -> Result<(), String> {
    validate_id(&id)?;
    let transaction = db.database.begin().await.map_err(|error| error.to_string())?;
    delete_dataset_rows(&transaction, &id).await?;
    transaction.commit().await.map_err(|error| error.to_string())?;
    let path = test_dataset_root(&app, &id)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn test_clip_list(
    db: State<'_, LocalDb>,
    dataset_id: String,
) -> Result<Vec<test_clip::Model>, String> {
    TestRepository::list_clips(&db.database, &dataset_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn test_clip_get(
    db: State<'_, LocalDb>,
    id: String,
) -> Result<Option<test_clip::Model>, String> {
    TestRepository::get_clip(&db.database, &id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn test_clip_create(
    app: AppHandle,
    db: State<'_, LocalDb>,
    input: CreateTestClipInput,
) -> Result<test_clip::Model, String> {
    validate_id(&input.id)?;
    validate_id(&input.dataset_id)?;
    if TestRepository::get_dataset(&db.database, &input.dataset_id)
        .await
        .map_err(String::from)?
        .is_none()
    {
        return Err("Test dataset was not found.".into());
    }
    let duration = input.end_time - input.start_time;
    if !duration.is_finite() || duration < MIN_CLIP_SECONDS {
        return Err(format!("Test clips must be at least {MIN_CLIP_SECONDS:.0} seconds."));
    }
    let source = PathBuf::from(&input.source_path);
    if !source.is_file() {
        return Err("Selected source video does not exist.".into());
    }
    let clip_dir = test_clip_dir(&app, &input.dataset_id, &input.id)?;
    fs::create_dir_all(&clip_dir).map_err(|error| error.to_string())?;
    let output_path = clip_dir.join("clip.mp4");
    let source_path = input.source_path.clone();
    let blocking_output = output_path.clone();
    let start = input.start_time;
    let end = input.end_time;
    let trim_result = tokio::task::spawn_blocking(move || {
        extract_clipper_segment_to_path_blocking(source_path, start, end, &blocking_output)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = trim_result {
        let _ = fs::remove_dir_all(&clip_dir);
        return Err(error);
    }
    let (actual_duration, width, height, frame_rate) = probe_video(&output_path)?;
    if actual_duration < MIN_CLIP_SECONDS - 0.05 {
        let _ = fs::remove_dir_all(&clip_dir);
        return Err(format!(
            "Trimmed clip duration is below {MIN_CLIP_SECONDS:.0} seconds ({actual_duration:.3}s)."
        ));
    }
    let sha256 = sha256_file(&output_path)?;
    let now = Utc::now().to_rfc3339();
    let relative = format!("clips/{}/clip.mp4", input.id);
    let active = test_clip::ActiveModel {
        id: Set(input.id),
        dataset_id: Set(input.dataset_id.clone()),
        name: Set(if input.name.trim().is_empty() { input.original_file_name.clone() } else { input.name.trim().to_owned() }),
        original_file_name: Set(input.original_file_name),
        media_relative_path: Set(relative),
        duration: Set(actual_duration),
        width: Set(width as i32),
        height: Set(height as i32),
        frame_rate: Set(frame_rate),
        sha256: Set(sha256),
        annotation_revision: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };
    match TestRepository::insert_clip(&db.database, active).await {
        Ok(model) => {
            if let Some(dataset) = test_dataset::Entity::find_by_id(input.dataset_id).one(&db.database).await.map_err(|e| e.to_string())? {
                let mut active: test_dataset::ActiveModel = dataset.into();
                active.updated_at = Set(now);
                active.update(&db.database).await.map_err(|e| e.to_string())?;
            }
            Ok(model)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(clip_dir);
            Err(error.into())
        }
    }
}

#[tauri::command]
pub async fn test_clip_delete(
    app: AppHandle,
    db: State<'_, LocalDb>,
    id: String,
) -> Result<(), String> {
    let clip = TestRepository::get_clip(&db.database, &id)
        .await
        .map_err(String::from)?
        .ok_or_else(|| "Test clip was not found.".to_string())?;
    let transaction = db.database.begin().await.map_err(|error| error.to_string())?;
    delete_clip_rows(&transaction, &id).await?;
    transaction.commit().await.map_err(|error| error.to_string())?;
    let path = test_clip_dir(&app, &clip.dataset_id, &clip.id)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn test_clip_annotations_get(
    db: State<'_, LocalDb>,
    clip_id: String,
) -> Result<Vec<TestKeyframeDto>, String> {
    TestRepository::annotations(&db.database, &clip_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn test_clip_annotations_replace(
    db: State<'_, LocalDb>,
    clip_id: String,
    keyframes: Vec<TestKeyframeDto>,
) -> Result<ReplaceAnnotationsResult, String> {
    let (annotation_revision, keyframes) = TestRepository::replace_annotations(
        &db.database,
        &clip_id,
        keyframes,
    )
    .await
    .map_err(String::from)?;
    Ok(ReplaceAnnotationsResult { annotation_revision, keyframes })
}

#[tauri::command]
pub async fn test_clip_file_path(
    app: AppHandle,
    db: State<'_, LocalDb>,
    id: String,
) -> Result<String, String> {
    let clip = TestRepository::get_clip(&db.database, &id)
        .await
        .map_err(String::from)?
        .ok_or_else(|| "Test clip was not found.".to_string())?;
    let path = test_dataset_root(&app, &clip.dataset_id)?.join(&clip.media_relative_path);
    if !path.is_file() {
        return Err("Stored test video is missing.".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_test_dataset_dir(app: AppHandle, dataset_id: String) -> Result<String, String> {
    validate_id(&dataset_id)?;
    let path = test_dataset_root(&app, &dataset_id)?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn benchmark_run_create(
    db: State<'_, LocalDb>,
    id: String,
    dataset_id: String,
    clip_ids: Vec<String>,
    config: Value,
) -> Result<benchmark_run::Model, String> {
    validate_id(&id)?;
    TestRepository::create_run(&db.database, id, dataset_id, serde_json::json!(clip_ids), config)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn benchmark_run_finish(
    db: State<'_, LocalDb>,
    id: String,
    status: String,
    error: Option<String>,
    manifest_relative_path: Option<String>,
) -> Result<benchmark_run::Model, String> {
    TestRepository::finish_run(&db.database, &id, status, error, manifest_relative_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn benchmark_run_list(
    db: State<'_, LocalDb>,
    dataset_id: String,
) -> Result<Vec<benchmark_run::Model>, String> {
    TestRepository::list_runs(&db.database, &dataset_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn benchmark_result_put(
    db: State<'_, LocalDb>,
    input: PutBenchmarkResultInput,
) -> Result<benchmark_result::Model, String> {
    let model = benchmark_result::ActiveModel {
        id: Set(input.id),
        run_id: Set(input.run_id),
        clip_id: Set(input.clip_id),
        aspect_id: Set(input.aspect_id),
        status: Set(input.status),
        metrics_json: Set(input.metrics.into()),
        details_relative_path: Set(input.details_relative_path),
        error: Set(input.error),
        created_at: Set(Utc::now().to_rfc3339()),
    };
    TestRepository::put_result(&db.database, model).await.map_err(Into::into)
}

#[tauri::command]
pub async fn benchmark_result_list(
    db: State<'_, LocalDb>,
    run_id: String,
) -> Result<Vec<benchmark_result::Model>, String> {
    TestRepository::list_results(&db.database, &run_id).await.map_err(Into::into)
}

#[tauri::command]
pub fn write_test_run_artifact(
    app: AppHandle,
    dataset_id: String,
    run_id: String,
    relative_path: String,
    contents: String,
) -> Result<String, String> {
    validate_id(&dataset_id)?;
    validate_id(&run_id)?;
    validate_relative_path(&relative_path)?;
    let root = test_run_dir(&app, &dataset_id, &run_id)?;
    let path = root.join(&relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.strip_prefix(test_dataset_root(&app, &dataset_id)?)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub async fn test_dataset_export(
    app: AppHandle,
    db: State<'_, LocalDb>,
    dataset_id: String,
    destination_path: String,
) -> Result<String, String> {
    let manifest = build_archive_manifest(&db.database, &dataset_id).await?;
    let root = test_dataset_root(&app, &dataset_id)?;
    let destination = PathBuf::from(destination_path);
    let write_destination = destination.clone();
    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = fs::File::create(&write_destination).map_err(|error| error.to_string())?;
        let encoder = BzEncoder::new(file, Compression::best());
        let mut archive = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest_json.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive.append_data(&mut header, "manifest.json", manifest_json.as_slice()).map_err(|error| error.to_string())?;
        if root.exists() {
            archive.append_dir_all("files", &root).map_err(|error| error.to_string())?;
        }
        archive.finish().map_err(|error| error.to_string())?;
        Ok(())
    }).await.map_err(|error| error.to_string())??;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn test_dataset_import(
    app: AppHandle,
    db: State<'_, LocalDb>,
    source_path: String,
) -> Result<test_dataset::Model, String> {
    let staging = app_test_root(&app)?.join(format!(".import-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let archive_path = PathBuf::from(source_path);
    let extract_root = staging.clone();
    let extract_result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
        let decoder = BzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        for entry in archive.entries().map_err(|error| error.to_string())? {
            let mut entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path().map_err(|error| error.to_string())?;
            if path.is_absolute() || path.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
                return Err("Archive contains an unsafe path.".into());
            }
            if !entry.unpack_in(&extract_root).map_err(|error| error.to_string())? {
                return Err("Archive entry escaped the import directory.".into());
            }
        }
        Ok(())
    }).await.map_err(|error| error.to_string())?;
    if let Err(error) = extract_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let result = import_staged_dataset(&app, &db.database, &staging).await;
    let _ = fs::remove_dir_all(&staging);
    result
}

fn app_test_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("test-datasets"))
}

pub(crate) fn test_dataset_root(app: &AppHandle, dataset_id: &str) -> Result<PathBuf, String> {
    validate_id(dataset_id)?;
    Ok(app_test_root(app)?.join(dataset_id))
}

pub(crate) fn test_clip_dir(app: &AppHandle, dataset_id: &str, clip_id: &str) -> Result<PathBuf, String> {
    validate_id(clip_id)?;
    Ok(test_dataset_root(app, dataset_id)?.join("clips").join(clip_id))
}

fn test_run_dir(app: &AppHandle, dataset_id: &str, run_id: &str) -> Result<PathBuf, String> {
    validate_id(run_id)?;
    Ok(test_dataset_root(app, dataset_id)?.join("runs").join(run_id))
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
        return Err("Invalid local test identifier.".into());
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if path.is_absolute() || path.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("Invalid relative artifact path.".into());
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn probe_video(path: &Path) -> Result<(f64, u32, u32, f64), String> {
    ffmpeg_next::init().map_err(|error| error.to_string())?;
    let input = ffmpeg_next::format::input(path).map_err(|error| error.to_string())?;
    let stream = input.streams().best(ffmpeg_next::media::Type::Video).ok_or("No video stream found.")?;
    let rate = stream.avg_frame_rate();
    let frame_rate = if rate.denominator() != 0 { rate.numerator() as f64 / rate.denominator() as f64 } else { 30.0 };
    let context = ffmpeg_next::codec::context::Context::from_parameters(stream.parameters()).map_err(|error| error.to_string())?;
    let decoder = context.decoder().video().map_err(|error| error.to_string())?;
    let duration = if input.duration() > 0 {
        input.duration() as f64 / ffmpeg_next::ffi::AV_TIME_BASE as f64
    } else if stream.duration() > 0 {
        let tb = stream.time_base();
        stream.duration() as f64 * tb.numerator() as f64 / tb.denominator() as f64
    } else { 0.0 };
    Ok((duration, decoder.width(), decoder.height(), frame_rate.max(1.0)))
}

async fn delete_clip_rows<C: ConnectionTrait>(db: &C, clip_id: &str) -> Result<(), String> {
    let keyframes = test_keyframe::Entity::find().filter(test_keyframe::Column::ClipId.eq(clip_id)).all(db).await.map_err(|e| e.to_string())?;
    let ids: Vec<String> = keyframes.into_iter().map(|row| row.id).collect();
    if !ids.is_empty() {
        test_target::Entity::delete_many().filter(test_target::Column::KeyframeId.is_in(ids)).exec(db).await.map_err(|e| e.to_string())?;
    }
    test_keyframe::Entity::delete_many().filter(test_keyframe::Column::ClipId.eq(clip_id)).exec(db).await.map_err(|e| e.to_string())?;
    benchmark_result::Entity::delete_many().filter(benchmark_result::Column::ClipId.eq(clip_id)).exec(db).await.map_err(|e| e.to_string())?;
    test_clip::Entity::delete_by_id(clip_id).exec(db).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn delete_dataset_rows<C: ConnectionTrait>(db: &C, dataset_id: &str) -> Result<(), String> {
    let clips = test_clip::Entity::find().filter(test_clip::Column::DatasetId.eq(dataset_id)).all(db).await.map_err(|e| e.to_string())?;
    for clip in clips { delete_clip_rows(db, &clip.id).await?; }
    let runs = benchmark_run::Entity::find().filter(benchmark_run::Column::DatasetId.eq(dataset_id)).all(db).await.map_err(|e| e.to_string())?;
    let run_ids: Vec<String> = runs.into_iter().map(|row| row.id).collect();
    if !run_ids.is_empty() {
        benchmark_result::Entity::delete_many().filter(benchmark_result::Column::RunId.is_in(run_ids)).exec(db).await.map_err(|e| e.to_string())?;
    }
    benchmark_run::Entity::delete_many().filter(benchmark_run::Column::DatasetId.eq(dataset_id)).exec(db).await.map_err(|e| e.to_string())?;
    test_dataset::Entity::delete_by_id(dataset_id).exec(db).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn build_archive_manifest(db: &sea_orm::DatabaseConnection, dataset_id: &str) -> Result<TestArchiveManifest, String> {
    let dataset = TestRepository::get_dataset(db, dataset_id).await.map_err(String::from)?.ok_or_else(|| "Test dataset was not found.".to_string())?;
    let clips = TestRepository::list_clips(db, dataset_id).await.map_err(String::from)?;
    let mut keyframes = Vec::new();
    for clip in &clips {
        keyframes.extend(TestRepository::annotations(db, &clip.id).await.map_err(String::from)?.into_iter().map(|keyframe| ArchiveKeyframe { clip_id: clip.id.clone(), keyframe }));
    }
    let runs = TestRepository::list_runs(db, dataset_id).await.map_err(String::from)?;
    let mut results = Vec::new();
    for run in &runs { results.extend(TestRepository::list_results(db, &run.id).await.map_err(String::from)?); }
    Ok(TestArchiveManifest { schema_version: TEST_ARCHIVE_SCHEMA_VERSION, dataset, clips, keyframes, runs, results })
}

async fn import_staged_dataset(
    app: &AppHandle,
    db: &sea_orm::DatabaseConnection,
    staging: &Path,
) -> Result<test_dataset::Model, String> {
    let manifest: TestArchiveManifest = serde_json::from_slice(
        &fs::read(staging.join("manifest.json")).map_err(|error| error.to_string())?,
    ).map_err(|error| format!("Invalid test archive manifest: {error}"))?;
    if manifest.schema_version > TEST_ARCHIVE_SCHEMA_VERSION {
        return Err(format!("Archive schema {} is newer than supported schema {}.", manifest.schema_version, TEST_ARCHIVE_SCHEMA_VERSION));
    }
    let source_files = staging.join("files");
    let dataset_id = Uuid::new_v4().to_string();
    let assembled = staging.join("assembled");
    fs::create_dir_all(&assembled).map_err(|error| error.to_string())?;
    let mut clip_map = HashMap::new();
    for clip in &manifest.clips {
        validate_relative_path(&clip.media_relative_path)?;
        let source = source_files.join(&clip.media_relative_path);
        if !source.is_file() || sha256_file(&source)? != clip.sha256 {
            return Err(format!("Clip {} is missing or has an invalid checksum.", clip.name));
        }
        let (duration, _, _, _) = probe_video(&source)?;
        if duration < MIN_CLIP_SECONDS - 0.05 {
            return Err(format!(
                "Imported clip {} is shorter than {MIN_CLIP_SECONDS:.0} seconds.",
                clip.name
            ));
        }
        let new_id = Uuid::new_v4().to_string();
        let target = assembled.join("clips").join(&new_id).join("clip.mp4");
        fs::create_dir_all(target.parent().unwrap()).map_err(|error| error.to_string())?;
        fs::copy(source, target).map_err(|error| error.to_string())?;
        clip_map.insert(clip.id.clone(), new_id);
    }
    let mut run_map = HashMap::new();
    for run in &manifest.runs {
        let new_id = Uuid::new_v4().to_string();
        let old_dir = source_files.join("runs").join(&run.id);
        let new_dir = assembled.join("runs").join(&new_id);
        if old_dir.is_dir() { copy_dir_all(&old_dir, &new_dir)?; }
        run_map.insert(run.id.clone(), new_id);
    }

    let transaction = db.begin().await.map_err(|error| error.to_string())?;
    let now = Utc::now().to_rfc3339();
    let imported_dataset = test_dataset::ActiveModel {
        id: Set(dataset_id.clone()),
        name: Set(manifest.dataset.name.clone()),
        description: Set(manifest.dataset.description.clone()),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    }.insert(&transaction).await.map_err(|error| error.to_string())?;
    for clip in &manifest.clips {
        let new_id = clip_map[&clip.id].clone();
        test_clip::ActiveModel {
            id: Set(new_id.clone()),
            dataset_id: Set(dataset_id.clone()),
            name: Set(clip.name.clone()),
            original_file_name: Set(clip.original_file_name.clone()),
            media_relative_path: Set(format!("clips/{new_id}/clip.mp4")),
            duration: Set(clip.duration),
            width: Set(clip.width),
            height: Set(clip.height),
            frame_rate: Set(clip.frame_rate),
            sha256: Set(clip.sha256.clone()),
            annotation_revision: Set(clip.annotation_revision),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        }.insert(&transaction).await.map_err(|error| error.to_string())?;
        for archived in manifest.keyframes.iter().filter(|frame| frame.clip_id == clip.id) {
            let frame_id = Uuid::new_v4().to_string();
            test_keyframe::ActiveModel {
                id: Set(frame_id.clone()),
                clip_id: Set(new_id.clone()),
                timestamp_us: Set(archived.keyframe.timestamp_us),
                layout_intent: Set(if archived.keyframe.layout_intent.is_empty() {
                    "crop".into()
                } else {
                    archived.keyframe.layout_intent.clone()
                }),
                created_at: Set(now.clone()),
                updated_at: Set(now.clone()),
            }.insert(&transaction).await.map_err(|error| error.to_string())?;
            for target in &archived.keyframe.targets {
                test_target::ActiveModel {
                    id: Set(Uuid::new_v4().to_string()),
                    keyframe_id: Set(frame_id.clone()),
                    slot: Set(target.slot),
                    x: Set(target.x),
                    y: Set(target.y),
                    width: Set(target.width),
                    height: Set(target.height),
                }.insert(&transaction).await.map_err(|error| error.to_string())?;
            }
        }
    }
    for run in &manifest.runs {
        let new_run_id = run_map[&run.id].clone();
        let selected: Vec<String> = serde_json::from_value::<Vec<String>>(run.selected_clip_ids_json.clone().into()).unwrap_or_default().into_iter().filter_map(|id| clip_map.get(&id).cloned()).collect();
        let mut config: Value = run.config_json.clone().into();
        if let Some(snapshots) = config.get_mut("annotationSnapshots").and_then(Value::as_object_mut) {
            let remapped = std::mem::take(snapshots)
                .into_iter()
                .filter_map(|(old_id, snapshot)| clip_map.get(&old_id).cloned().map(|new_id| (new_id, snapshot)))
                .collect();
            *snapshots = remapped;
        }
        benchmark_run::ActiveModel {
            id: Set(new_run_id.clone()),
            dataset_id: Set(dataset_id.clone()),
            status: Set(run.status.clone()),
            selected_clip_ids_json: Set(serde_json::json!(selected).into()),
            config_json: Set(config.into()),
            manifest_relative_path: Set(run.manifest_relative_path.as_ref().map(|_| format!("runs/{new_run_id}/manifest.json"))),
            error: Set(run.error.clone()),
            started_at: Set(run.started_at.clone()),
            completed_at: Set(run.completed_at.clone()),
            created_at: Set(run.created_at.clone()),
        }.insert(&transaction).await.map_err(|error| error.to_string())?;
    }
    for result in &manifest.results {
        let Some(new_run_id) = run_map.get(&result.run_id) else { continue; };
        let Some(new_clip_id) = clip_map.get(&result.clip_id) else { continue; };
        let details_relative_path = result.details_relative_path.as_ref().and_then(|path| {
            Path::new(path).strip_prefix(Path::new("runs").join(&result.run_id)).ok().map(|suffix| Path::new("runs").join(new_run_id).join(suffix).to_string_lossy().replace('\\', "/"))
        });
        benchmark_result::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            run_id: Set(new_run_id.clone()),
            clip_id: Set(new_clip_id.clone()),
            aspect_id: Set(result.aspect_id.clone()),
            status: Set(result.status.clone()),
            metrics_json: Set(result.metrics_json.clone()),
            details_relative_path: Set(details_relative_path),
            error: Set(result.error.clone()),
            created_at: Set(result.created_at.clone()),
        }.insert(&transaction).await.map_err(|error| error.to_string())?;
    }
    let final_root = test_dataset_root(app, &dataset_id)?;
    fs::create_dir_all(final_root.parent().unwrap()).map_err(|error| error.to_string())?;
    fs::rename(&assembled, &final_root).map_err(|error| error.to_string())?;
    if let Err(error) = transaction.commit().await {
        let _ = fs::remove_dir_all(final_root);
        return Err(error.to_string());
    }
    Ok(imported_dataset)
}

fn copy_dir_all(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let destination = target.join(entry.file_name());
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            copy_dir_all(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[path = "benchmark_miss_export.rs"]
pub mod benchmark_miss_export;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_ids_and_artifact_paths() {
        assert!(validate_id("dataset-123").is_ok());
        assert!(validate_id("../dataset").is_err());
        assert!(validate_relative_path("clips/clip-1/9-16.jsonl").is_ok());
        assert!(validate_relative_path("../outside.json").is_err());
        assert!(validate_relative_path("/absolute.json").is_err());
    }
}
