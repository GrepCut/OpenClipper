use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, Set, TransactionTrait};
use tauri::{AppHandle, State};

use crate::infra::model_download::sha256_file;
use crate::storage::database::LocalDb;
use crate::storage::entity::{test_clip, test_dataset};
use crate::storage::repository::test_repository::TestKeyframeDto;
use crate::storage::repository::TestRepository;
use crate::video::ffmpeg::frames::{
    extract_clipper_segment_to_path_blocking, probe_video_metadata,
};

use super::archive::delete_clip_rows;
use super::paths::{test_clip_dir, test_dataset_root, validate_id};
use super::types::{CreateTestClipInput, ReplaceAnnotationsResult, MIN_CLIP_SECONDS};

#[tauri::command]
pub async fn test_clip_update_cohorts(
    db: State<'_, LocalDb>,
    id: String,
    cohort_tags_json: String,
) -> Result<test_clip::Model, String> {
    TestRepository::update_clip_cohorts(&db.database, id, cohort_tags_json)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_clip_list(
    db: State<'_, LocalDb>,
    dataset_id: String,
) -> Result<Vec<test_clip::Model>, String> {
    TestRepository::list_clips(&db.database, &dataset_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_clip_get(
    db: State<'_, LocalDb>,
    id: String,
) -> Result<Option<test_clip::Model>, String> {
    TestRepository::get_clip(&db.database, &id)
        .await
        .map_err(Into::into)
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
        return Err(format!(
            "Test clips must be at least {MIN_CLIP_SECONDS:.0} seconds."
        ));
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
    let (actual_duration, width, height, frame_rate) = probe_video_metadata(&output_path)?;
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
        name: Set(if input.name.trim().is_empty() {
            input.original_file_name.clone()
        } else {
            input.name.trim().to_owned()
        }),
        original_file_name: Set(input.original_file_name),
        media_relative_path: Set(relative),
        duration: Set(actual_duration),
        width: Set(width as i32),
        height: Set(height as i32),
        frame_rate: Set(frame_rate),
        sha256: Set(sha256),
        annotation_revision: Set(0),
        cohort_tags_json: Set("[]".into()),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };
    match TestRepository::insert_clip(&db.database, active).await {
        Ok(model) => {
            if let Some(dataset) = test_dataset::Entity::find_by_id(input.dataset_id)
                .one(&db.database)
                .await
                .map_err(|e| e.to_string())?
            {
                let mut active: test_dataset::ActiveModel = dataset.into();
                active.updated_at = Set(now);
                active
                    .update(&db.database)
                    .await
                    .map_err(|e| e.to_string())?;
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
    let transaction = db
        .database
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    delete_clip_rows(&transaction, &id).await?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
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
    TestRepository::annotations(&db.database, &clip_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_clip_annotations_replace(
    db: State<'_, LocalDb>,
    clip_id: String,
    keyframes: Vec<TestKeyframeDto>,
) -> Result<ReplaceAnnotationsResult, String> {
    let (annotation_revision, keyframes) =
        TestRepository::replace_annotations(&db.database, &clip_id, keyframes)
            .await
            .map_err(String::from)?;
    Ok(ReplaceAnnotationsResult {
        annotation_revision,
        keyframes,
    })
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
