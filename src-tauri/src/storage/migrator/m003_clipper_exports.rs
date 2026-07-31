use chrono::Utc;
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter};
use serde_json::Value;

use crate::storage::entity::local_record::{Column as RecordColumn, Entity as LocalRecordEntity};

use super::{impl_migration, Migration};

const EXPORTS_NAMESPACE: &str = "clipper-exports";

pub struct M003ClipperExports;

impl_migration!(M003ClipperExports, 3, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    db.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS clipper_exports (
            id TEXT PRIMARY KEY NOT NULL,
            project_id TEXT NOT NULL,
            clip_index INTEGER NOT NULL,
            format_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            file_size INTEGER NOT NULL,
            clip_start_sec REAL,
            clip_end_sec REAL,
            exported_at TEXT NOT NULL,
            transcript_plain TEXT NOT NULL DEFAULT '',
            transcript_timestamped TEXT NOT NULL DEFAULT '',
            social_title TEXT NOT NULL DEFAULT '',
            social_short_description TEXT NOT NULL DEFAULT '',
            social_description TEXT NOT NULL DEFAULT '',
            social_description_timestamped TEXT NOT NULL DEFAULT '',
            social_hashtags TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;

    db.execute_unprepared(
        "CREATE INDEX IF NOT EXISTS idx_clipper_exports_project_id ON clipper_exports(project_id)",
    )
    .await?;

    backfill_from_local_records(db).await?;

    Ok(())
}

async fn backfill_from_local_records(db: &DatabaseConnection) -> Result<(), DbErr> {
    let rows = LocalRecordEntity::find()
        .filter(RecordColumn::Namespace.eq(EXPORTS_NAMESPACE))
        .all(db)
        .await?;

    for row in rows {
        let project_id = row
            .project_id
            .clone()
            .unwrap_or_else(|| row.record_key.clone());

        let exports = match row.payload_json {
            Value::Array(items) => items,
            _ => continue,
        };

        for export in exports {
            if let Some(insert_sql) = export_to_insert_sql(&project_id, &export) {
                db.execute_unprepared(&insert_sql).await?;
            }
        }
    }

    Ok(())
}

fn export_to_insert_sql(project_id: &str, export: &Value) -> Option<String> {
    let id = export.get("id").and_then(Value::as_str)?;
    let clip_index = export.get("clipIndex").and_then(Value::as_i64)?;
    let format_id = export.get("formatId").and_then(Value::as_str)?;
    let file_name = export.get("fileName").and_then(Value::as_str)?;
    let relative_path = export.get("relativePath").and_then(Value::as_str)?;
    let width = export.get("width").and_then(Value::as_i64)?;
    let height = export.get("height").and_then(Value::as_i64)?;
    let file_size = export.get("fileSize").and_then(Value::as_i64)?;
    let exported_at = export
        .get("createdAt")
        .or_else(|| export.get("updatedAt"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let clip_start_sec = export.get("clipStartSec").and_then(Value::as_f64);
    let clip_end_sec = export.get("clipEndSec").and_then(Value::as_f64);
    let created_at = export
        .get("createdAt")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| exported_at.clone());
    let updated_at = export
        .get("updatedAt")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| exported_at.clone());

    Some(format!(
        "INSERT OR IGNORE INTO clipper_exports (
            id, project_id, clip_index, format_id, file_name, relative_path,
            width, height, file_size, clip_start_sec, clip_end_sec, exported_at,
            transcript_plain, transcript_timestamped,
            social_title, social_short_description, social_description,
            social_description_timestamped, social_hashtags,
            created_at, updated_at
        ) VALUES (
            '{id}', '{project_id}', {clip_index}, '{format_id}', '{file_name}', '{relative_path}',
            {width}, {height}, {file_size}, {clip_start_sql}, {clip_end_sql}, '{exported_at}',
            '', '', '', '', '', '', '',
            '{created_at}', '{updated_at}'
        )",
        id = escape_sql(id),
        project_id = escape_sql(project_id),
        clip_index = clip_index,
        format_id = escape_sql(format_id),
        file_name = escape_sql(file_name),
        relative_path = escape_sql(relative_path),
        width = width,
        height = height,
        file_size = file_size,
        clip_start_sql = optional_f64_sql(clip_start_sec),
        clip_end_sql = optional_f64_sql(clip_end_sec),
        exported_at = escape_sql(&exported_at),
        created_at = escape_sql(&created_at),
        updated_at = escape_sql(&updated_at),
    ))
}

fn escape_sql(value: &str) -> String {
    value.replace('\'', "''")
}

fn optional_f64_sql(value: Option<f64>) -> String {
    match value {
        Some(v) => v.to_string(),
        None => "NULL".to_string(),
    }
}
