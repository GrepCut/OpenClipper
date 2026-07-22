use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

use crate::entity::{
    benchmark_result, benchmark_run, test_clip, test_dataset, test_keyframe, test_target,
};
use crate::model_download::sha256_file;
use crate::repository::TestRepository;
use crate::video_processing::probe_video_metadata;

use super::paths::{test_dataset_root, validate_relative_path};
use super::types::{
    ArchiveKeyframe, TestArchiveManifest, TEST_ARCHIVE_SCHEMA_VERSION, MIN_CLIP_SECONDS,
};

pub(crate) async fn delete_clip_rows<C: ConnectionTrait>(
    db: &C,
    clip_id: &str,
) -> Result<(), String> {
    let keyframes = test_keyframe::Entity::find()
        .filter(test_keyframe::Column::ClipId.eq(clip_id))
        .all(db)
        .await
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = keyframes.into_iter().map(|row| row.id).collect();
    if !ids.is_empty() {
        test_target::Entity::delete_many()
            .filter(test_target::Column::KeyframeId.is_in(ids))
            .exec(db)
            .await
            .map_err(|e| e.to_string())?;
    }
    test_keyframe::Entity::delete_many()
        .filter(test_keyframe::Column::ClipId.eq(clip_id))
        .exec(db)
        .await
        .map_err(|e| e.to_string())?;
    benchmark_result::Entity::delete_many()
        .filter(benchmark_result::Column::ClipId.eq(clip_id))
        .exec(db)
        .await
        .map_err(|e| e.to_string())?;
    test_clip::Entity::delete_by_id(clip_id)
        .exec(db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) async fn delete_dataset_rows<C: ConnectionTrait>(
    db: &C,
    dataset_id: &str,
) -> Result<(), String> {
    let clips = test_clip::Entity::find()
        .filter(test_clip::Column::DatasetId.eq(dataset_id))
        .all(db)
        .await
        .map_err(|e| e.to_string())?;
    for clip in clips {
        delete_clip_rows(db, &clip.id).await?;
    }
    let runs = benchmark_run::Entity::find()
        .filter(benchmark_run::Column::DatasetId.eq(dataset_id))
        .all(db)
        .await
        .map_err(|e| e.to_string())?;
    let run_ids: Vec<String> = runs.into_iter().map(|row| row.id).collect();
    if !run_ids.is_empty() {
        benchmark_result::Entity::delete_many()
            .filter(benchmark_result::Column::RunId.is_in(run_ids))
            .exec(db)
            .await
            .map_err(|e| e.to_string())?;
    }
    benchmark_run::Entity::delete_many()
        .filter(benchmark_run::Column::DatasetId.eq(dataset_id))
        .exec(db)
        .await
        .map_err(|e| e.to_string())?;
    test_dataset::Entity::delete_by_id(dataset_id)
        .exec(db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) async fn build_archive_manifest(
    db: &sea_orm::DatabaseConnection,
    dataset_id: &str,
) -> Result<TestArchiveManifest, String> {
    let dataset = TestRepository::get_dataset(db, dataset_id)
        .await
        .map_err(String::from)?
        .ok_or_else(|| "Test dataset was not found.".to_string())?;
    let clips = TestRepository::list_clips(db, dataset_id)
        .await
        .map_err(String::from)?;
    let mut keyframes = Vec::new();
    for clip in &clips {
        keyframes.extend(
            TestRepository::annotations(db, &clip.id)
                .await
                .map_err(String::from)?
                .into_iter()
                .map(|keyframe| ArchiveKeyframe {
                    clip_id: clip.id.clone(),
                    keyframe,
                }),
        );
    }
    let runs = TestRepository::list_runs(db, dataset_id)
        .await
        .map_err(String::from)?;
    let mut results = Vec::new();
    for run in &runs {
        results.extend(
            TestRepository::list_results(db, &run.id)
                .await
                .map_err(String::from)?,
        );
    }
    Ok(TestArchiveManifest {
        schema_version: TEST_ARCHIVE_SCHEMA_VERSION,
        dataset,
        clips,
        keyframes,
        runs,
        results,
    })
}

pub(crate) async fn import_staged_dataset(
    app: &AppHandle,
    db: &sea_orm::DatabaseConnection,
    staging: &Path,
) -> Result<test_dataset::Model, String> {
    let manifest: TestArchiveManifest = serde_json::from_slice(
        &fs::read(staging.join("manifest.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Invalid test archive manifest: {error}"))?;
    if manifest.schema_version > TEST_ARCHIVE_SCHEMA_VERSION {
        return Err(format!(
            "Archive schema {} is newer than supported schema {}.",
            manifest.schema_version, TEST_ARCHIVE_SCHEMA_VERSION
        ));
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
            return Err(format!(
                "Clip {} is missing or has an invalid checksum.",
                clip.name
            ));
        }
        let (duration, _, _, _) = probe_video_metadata(&source)?;
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
        if old_dir.is_dir() {
            copy_dir_all(&old_dir, &new_dir)?;
        }
        run_map.insert(run.id.clone(), new_id);
    }

    let transaction = db.begin().await.map_err(|error| error.to_string())?;
    let now = Utc::now().to_rfc3339();
    let imported_dataset = test_dataset::ActiveModel {
        id: Set(dataset_id.clone()),
        name: Set(manifest.dataset.name.clone()),
        description: Set(manifest.dataset.description.clone()),
        dataset_role: Set(manifest.dataset.dataset_role.clone()),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    }
    .insert(&transaction)
    .await
    .map_err(|error| error.to_string())?;
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
            cohort_tags_json: Set(clip.cohort_tags_json.clone()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        }
        .insert(&transaction)
        .await
        .map_err(|error| error.to_string())?;
        for archived in manifest
            .keyframes
            .iter()
            .filter(|frame| frame.clip_id == clip.id)
        {
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
            }
            .insert(&transaction)
            .await
            .map_err(|error| error.to_string())?;
            for target in &archived.keyframe.targets {
                test_target::ActiveModel {
                    id: Set(Uuid::new_v4().to_string()),
                    keyframe_id: Set(frame_id.clone()),
                    slot: Set(target.slot),
                    x: Set(target.x),
                    y: Set(target.y),
                    width: Set(target.width),
                    height: Set(target.height),
                }
                .insert(&transaction)
                .await
                .map_err(|error| error.to_string())?;
            }
        }
    }
    for run in &manifest.runs {
        let new_run_id = run_map[&run.id].clone();
        let selected: Vec<String> =
            serde_json::from_value::<Vec<String>>(run.selected_clip_ids_json.clone().into())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|id| clip_map.get(&id).cloned())
                .collect();
        let mut config: Value = run.config_json.clone().into();
        if let Some(snapshots) = config
            .get_mut("annotationSnapshots")
            .and_then(Value::as_object_mut)
        {
            let remapped = std::mem::take(snapshots)
                .into_iter()
                .filter_map(|(old_id, snapshot)| {
                    clip_map
                        .get(&old_id)
                        .cloned()
                        .map(|new_id| (new_id, snapshot))
                })
                .collect();
            *snapshots = remapped;
        }
        benchmark_run::ActiveModel {
            id: Set(new_run_id.clone()),
            dataset_id: Set(dataset_id.clone()),
            status: Set(run.status.clone()),
            selected_clip_ids_json: Set(serde_json::json!(selected).into()),
            config_json: Set(config.into()),
            manifest_relative_path: Set(run
                .manifest_relative_path
                .as_ref()
                .map(|_| format!("runs/{new_run_id}/manifest.json"))),
            error: Set(run.error.clone()),
            started_at: Set(run.started_at.clone()),
            completed_at: Set(run.completed_at.clone()),
            created_at: Set(run.created_at.clone()),
        }
        .insert(&transaction)
        .await
        .map_err(|error| error.to_string())?;
    }
    for result in &manifest.results {
        let Some(new_run_id) = run_map.get(&result.run_id) else {
            continue;
        };
        let Some(new_clip_id) = clip_map.get(&result.clip_id) else {
            continue;
        };
        let details_relative_path = result.details_relative_path.as_ref().and_then(|path| {
            Path::new(path)
                .strip_prefix(Path::new("runs").join(&result.run_id))
                .ok()
                .map(|suffix| {
                    Path::new("runs")
                        .join(new_run_id)
                        .join(suffix)
                        .to_string_lossy()
                        .replace('\\', "/")
                })
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
        }
        .insert(&transaction)
        .await
        .map_err(|error| error.to_string())?;
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
