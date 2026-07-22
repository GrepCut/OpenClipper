use std::fs;

use chrono::Utc;
use sea_orm::Set;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::storage::database::LocalDb;
use crate::storage::entity::{benchmark_result, benchmark_run};
use crate::storage::repository::TestRepository;

use super::paths::{test_dataset_root, test_run_dir, validate_id, validate_relative_path};
use super::types::PutBenchmarkResultInput;

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
    TestRepository::finish_run(
        &db.database,
        &id,
        status,
        error,
        manifest_relative_path,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn benchmark_run_list(
    db: State<'_, LocalDb>,
    dataset_id: String,
) -> Result<Vec<benchmark_run::Model>, String> {
    TestRepository::list_runs(&db.database, &dataset_id)
        .await
        .map_err(Into::into)
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
    TestRepository::put_result(&db.database, model)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn benchmark_result_list(
    db: State<'_, LocalDb>,
    run_id: String,
) -> Result<Vec<benchmark_result::Model>, String> {
    TestRepository::list_results(&db.database, &run_id)
        .await
        .map_err(Into::into)
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
    Ok(path
        .strip_prefix(test_dataset_root(&app, &dataset_id)?)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}
