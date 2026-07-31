use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sea_orm::{DatabaseConnection, DbErr, EntityTrait};
use serde::Deserialize;
use uuid::Uuid;

use crate::storage::entity::clipper_export::Entity as ClipperExportEntity;
use crate::storage::repository::export_repository::{ClipperExportUpsertInput, ExportRepository};

use super::{impl_migration, Migration};

const LEGACY_EXPORT_NAMESPACE: &str = "a3f2c8e1-4b5d-4e6f-9a0b-1c2d3e4f5a6b";

pub struct M005ClipperExportsManifestSync;

impl_migration!(M005ClipperExportsManifestSync, 5, up);

#[derive(Debug, Deserialize)]
struct ManifestFile {
    exports: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    id: Option<String>,
    clip_index: i32,
    format_id: String,
    file_name: String,
    relative_path: String,
    width: i32,
    height: i32,
    file_size: i64,
    exported_at: Option<String>,
    clip_start_sec: Option<f64>,
    clip_end_sec: Option<f64>,
}

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    let projects_root = projects_root_dir();
    if !projects_root.is_dir() {
        return Ok(());
    }

    let project_dirs = fs::read_dir(&projects_root).map_err(|error| {
        DbErr::Custom(format!(
            "Cannot read projects directory {}: {error}",
            projects_root.display()
        ))
    })?;

    for entry in project_dirs.flatten() {
        let project_id = entry.file_name().to_string_lossy().into_owned();
        if let Err(error) = sync_project_manifest(db, &project_id, &entry.path()).await {
            log::warn!("M005: manifest sync failed for project {project_id}: {error}");
        }
    }

    Ok(())
}

fn projects_root_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.openclipper.app")
        .join("projects")
}

fn manifest_paths(project_root: &Path) -> Vec<PathBuf> {
    vec![
        project_root.join("data").join("exports").join("manifest.json"),
        project_root
            .join("clipper-data")
            .join("exports")
            .join("manifest.json"),
    ]
}

async fn sync_project_manifest(
    db: &DatabaseConnection,
    project_id: &str,
    project_root: &Path,
) -> Result<(), DbErr> {
    for manifest_path in manifest_paths(project_root) {
        if !manifest_path.is_file() {
            continue;
        }
        let contents = fs::read_to_string(&manifest_path).map_err(|error| {
            DbErr::Custom(format!(
                "Cannot read manifest {}: {error}",
                manifest_path.display()
            ))
        })?;
        let manifest: ManifestFile = serde_json::from_str(&contents).map_err(|error| {
            DbErr::Custom(format!(
                "Cannot parse manifest {}: {error}",
                manifest_path.display()
            ))
        })?;
        for entry in manifest.exports {
            sync_manifest_entry(db, project_id, entry).await?;
        }
    }
    Ok(())
}

async fn sync_manifest_entry(
    db: &DatabaseConnection,
    project_id: &str,
    entry: ManifestEntry,
) -> Result<(), DbErr> {
    let export_id = entry
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| legacy_clipper_export_id(project_id, entry.clip_index, &entry.format_id));

    if ClipperExportEntity::find_by_id(export_id.clone())
        .one(db)
        .await?
        .is_some()
    {
        return Ok(());
    }

    let exported_at = entry
        .exported_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    ExportRepository::upsert(
        db,
        project_id,
        ClipperExportUpsertInput {
            id: export_id,
            clip_index: entry.clip_index,
            format_id: entry.format_id,
            file_name: entry.file_name,
            relative_path: entry.relative_path,
            width: entry.width,
            height: entry.height,
            file_size: entry.file_size,
            clip_start_sec: entry.clip_start_sec,
            clip_end_sec: entry.clip_end_sec,
            exported_at,
            transcript_plain: None,
            transcript_timestamped: None,
            social_title: None,
            social_short_description: None,
            social_description: None,
            social_description_timestamped: None,
            social_hashtags: None,
        },
    )
    .await
    .map_err(|error| DbErr::Custom(error.to_string()))?;

    Ok(())
}

fn legacy_clipper_export_id(project_id: &str, clip_index: i32, format_id: &str) -> String {
    let namespace = Uuid::parse_str(LEGACY_EXPORT_NAMESPACE)
        .expect("legacy export namespace must be a valid UUID");
    let name = format!("{project_id}:{clip_index}:{format_id}");
    Uuid::new_v5(&namespace, name.as_bytes()).to_string()
}
