use std::fs;
use std::path::PathBuf;

use bzip2::{write::BzEncoder, Compression};
use sea_orm::TransactionTrait;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::database::LocalDb;
use crate::entity::test_dataset;
use crate::model_download::extract_tar_bz2_safe;
use crate::repository::test_repository::TestDatasetSummary;
use crate::repository::TestRepository;

use super::archive::{build_archive_manifest, delete_dataset_rows, import_staged_dataset};
use super::paths::{app_test_root, test_dataset_root, validate_id};

#[tauri::command]
pub async fn test_dataset_list(
    db: State<'_, LocalDb>,
) -> Result<Vec<TestDatasetSummary>, String> {
    TestRepository::list_datasets(&db.database)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_dataset_get(
    db: State<'_, LocalDb>,
    id: String,
) -> Result<Option<test_dataset::Model>, String> {
    TestRepository::get_dataset(&db.database, &id)
        .await
        .map_err(Into::into)
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
pub async fn test_dataset_update_role(
    db: State<'_, LocalDb>,
    id: String,
    dataset_role: String,
) -> Result<test_dataset::Model, String> {
    TestRepository::update_dataset_role(&db.database, id, dataset_role)
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
    let transaction = db
        .database
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    delete_dataset_rows(&transaction, &id).await?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    let path = test_dataset_root(&app, &id)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
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
        archive
            .append_data(&mut header, "manifest.json", manifest_json.as_slice())
            .map_err(|error| error.to_string())?;
        if root.exists() {
            archive
                .append_dir_all("files", &root)
                .map_err(|error| error.to_string())?;
        }
        archive.finish().map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;
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
    let extract_result = tokio::task::spawn_blocking(move || {
        extract_tar_bz2_safe(&archive_path, &extract_root)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = extract_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let result = import_staged_dataset(&app, &db.database, &staging).await;
    let _ = fs::remove_dir_all(&staging);
    result
}
