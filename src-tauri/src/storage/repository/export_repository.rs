use chrono::Utc;
use sea_orm::{
    sea_query::OnConflict, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};

use crate::infra::error::{DbError, DbResult};
use crate::storage::entity::clipper_export::{ActiveModel, Column, Entity, Model};
use crate::storage::export_social_util::apply_description_timestamps;

pub struct ExportRepository;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SocialPatchMode {
    Overwrite,
    FillMissing,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportSocialPatch {
    pub social_title: Option<String>,
    pub social_short_description: Option<String>,
    pub social_description: Option<String>,
    pub social_description_timestamped: Option<String>,
    pub social_hashtags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportRecord {
    pub id: String,
    pub project_id: String,
    pub clip_index: i32,
    pub format_id: String,
    pub file_name: String,
    pub relative_path: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub clip_start_sec: Option<f64>,
    pub clip_end_sec: Option<f64>,
    pub exported_at: String,
    pub transcript_plain: String,
    pub transcript_timestamped: String,
    pub social_title: String,
    pub social_short_description: String,
    pub social_description: String,
    pub social_description_timestamped: String,
    pub social_hashtags: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportUpsertInput {
    pub id: String,
    pub clip_index: i32,
    pub format_id: String,
    pub file_name: String,
    pub relative_path: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub clip_start_sec: Option<f64>,
    pub clip_end_sec: Option<f64>,
    pub exported_at: String,
    pub transcript_plain: Option<String>,
    pub transcript_timestamped: Option<String>,
    pub social_title: Option<String>,
    pub social_short_description: Option<String>,
    pub social_description: Option<String>,
    pub social_description_timestamped: Option<String>,
    pub social_hashtags: Option<String>,
}

impl ExportRepository {
    pub async fn upsert(
        database: &DatabaseConnection,
        project_id: &str,
        input: ClipperExportUpsertInput,
    ) -> DbResult<ClipperExportRecord> {
        let now = Utc::now().to_rfc3339();
        let existing = Entity::find_by_id(input.id.clone()).one(database).await?;

        let created_at = existing
            .as_ref()
            .map(|row| row.created_at.clone())
            .unwrap_or_else(|| input.exported_at.clone());

        let transcript_plain = input
            .transcript_plain
            .unwrap_or_else(|| existing.as_ref().map(|r| r.transcript_plain.clone()).unwrap_or_default());
        let transcript_timestamped = input
            .transcript_timestamped
            .unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|r| r.transcript_timestamped.clone())
                    .unwrap_or_default()
            });
        let social_title = input
            .social_title
            .unwrap_or_else(|| existing.as_ref().map(|r| r.social_title.clone()).unwrap_or_default());
        let social_short_description = input
            .social_short_description
            .unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|r| r.social_short_description.clone())
                    .unwrap_or_default()
            });
        let social_description = input
            .social_description
            .unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|r| r.social_description.clone())
                    .unwrap_or_default()
            });
        let social_description_timestamped = input
            .social_description_timestamped
            .unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|r| r.social_description_timestamped.clone())
                    .unwrap_or_default()
            });
        let social_hashtags = input
            .social_hashtags
            .unwrap_or_else(|| existing.as_ref().map(|r| r.social_hashtags.clone()).unwrap_or_default());

        let active_model = ActiveModel {
            id: sea_orm::Set(input.id.clone()),
            project_id: sea_orm::Set(project_id.to_string()),
            clip_index: sea_orm::Set(input.clip_index),
            format_id: sea_orm::Set(input.format_id),
            file_name: sea_orm::Set(input.file_name),
            relative_path: sea_orm::Set(input.relative_path),
            width: sea_orm::Set(input.width),
            height: sea_orm::Set(input.height),
            file_size: sea_orm::Set(input.file_size),
            clip_start_sec: sea_orm::Set(input.clip_start_sec),
            clip_end_sec: sea_orm::Set(input.clip_end_sec),
            exported_at: sea_orm::Set(input.exported_at),
            transcript_plain: sea_orm::Set(transcript_plain),
            transcript_timestamped: sea_orm::Set(transcript_timestamped),
            social_title: sea_orm::Set(social_title),
            social_short_description: sea_orm::Set(social_short_description),
            social_description: sea_orm::Set(social_description),
            social_description_timestamped: sea_orm::Set(social_description_timestamped),
            social_hashtags: sea_orm::Set(social_hashtags),
            created_at: sea_orm::Set(created_at),
            updated_at: sea_orm::Set(now),
        };

        Entity::insert(active_model)
            .on_conflict(
                OnConflict::column(Column::Id)
                    .update_columns([
                        Column::ProjectId,
                        Column::ClipIndex,
                        Column::FormatId,
                        Column::FileName,
                        Column::RelativePath,
                        Column::Width,
                        Column::Height,
                        Column::FileSize,
                        Column::ClipStartSec,
                        Column::ClipEndSec,
                        Column::ExportedAt,
                        Column::TranscriptPlain,
                        Column::TranscriptTimestamped,
                        Column::SocialTitle,
                        Column::SocialShortDescription,
                        Column::SocialDescription,
                        Column::SocialDescriptionTimestamped,
                        Column::SocialHashtags,
                        Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec(database)
            .await?;

        let row = Entity::find_by_id(input.id)
            .one(database)
            .await?
            .expect("clipper_export row missing after upsert");

        Ok(model_to_record(row))
    }

    pub async fn list_by_project(
        database: &DatabaseConnection,
        project_id: &str,
    ) -> DbResult<Vec<ClipperExportRecord>> {
        let rows = Entity::find()
            .filter(Column::ProjectId.eq(project_id))
            .order_by_desc(Column::ExportedAt)
            .all(database)
            .await?;

        Ok(rows.into_iter().map(model_to_record).collect())
    }

    pub async fn get_by_id(
        database: &DatabaseConnection,
        export_id: &str,
    ) -> DbResult<Option<ClipperExportRecord>> {
        let row = Entity::find_by_id(export_id).one(database).await?;
        Ok(row.map(model_to_record))
    }

    pub async fn list_all(
        database: &DatabaseConnection,
        project_id: Option<&str>,
    ) -> DbResult<Vec<ClipperExportRecord>> {
        let mut query = Entity::find().order_by_desc(Column::ExportedAt);
        if let Some(project_id) = project_id {
            query = query.filter(Column::ProjectId.eq(project_id));
        }
        let rows = query.all(database).await?;
        Ok(rows.into_iter().map(model_to_record).collect())
    }

    pub async fn patch_social_metadata(
        database: &DatabaseConnection,
        export_id: &str,
        patch: ClipperExportSocialPatch,
        mode: SocialPatchMode,
    ) -> DbResult<ClipperExportRecord> {
        let existing = Entity::find_by_id(export_id)
            .one(database)
            .await?
            .ok_or_else(|| DbError::message(format!("Export not found: {export_id}")))?;

        let patch_description_timestamped = patch.social_description_timestamped.is_some();
        let patch_description = patch.social_description.is_some();

        let social_title = merge_social_field(
            &existing.social_title,
            patch.social_title,
            mode,
        );
        let social_short_description = merge_social_field(
            &existing.social_short_description,
            patch.social_short_description,
            mode,
        );
        let social_description = merge_social_field(
            &existing.social_description,
            patch.social_description,
            mode,
        );
        let mut social_description_timestamped = merge_social_field(
            &existing.social_description_timestamped,
            patch.social_description_timestamped,
            mode,
        );
        let social_hashtags = merge_social_field(
            &existing.social_hashtags,
            patch.social_hashtags,
            mode,
        );

        let clip_duration_sec = match (existing.clip_start_sec, existing.clip_end_sec) {
            (Some(start), Some(end)) if end > start => end - start,
            _ => 0.0,
        };

        let should_apply_timestamps = patch_description_timestamped
            || (patch_description && social_description_timestamped.trim().is_empty());

        if should_apply_timestamps {
            let body = if !social_description_timestamped.trim().is_empty() {
                social_description_timestamped.clone()
            } else {
                social_description.clone()
            };

            if !body.trim().is_empty() {
                social_description_timestamped = apply_description_timestamps(
                    &body,
                    &existing.transcript_timestamped,
                    clip_duration_sec,
                );
            }
        }

        let now = Utc::now().to_rfc3339();
        let mut active: ActiveModel = existing.into();
        active.social_title = sea_orm::Set(social_title);
        active.social_short_description = sea_orm::Set(social_short_description);
        active.social_description = sea_orm::Set(social_description);
        active.social_description_timestamped = sea_orm::Set(social_description_timestamped);
        active.social_hashtags = sea_orm::Set(social_hashtags);
        active.updated_at = sea_orm::Set(now);
        active.update(database).await?;

        let row = Entity::find_by_id(export_id)
            .one(database)
            .await?
            .expect("clipper_export row missing after patch");

        Ok(model_to_record(row))
    }

    pub async fn delete_by_ids(
        database: &DatabaseConnection,
        export_ids: &[String],
    ) -> DbResult<u64> {
        if export_ids.is_empty() {
            return Ok(0);
        }

        let result = Entity::delete_many()
            .filter(Column::Id.is_in(export_ids.iter().map(String::clone)))
            .exec(database)
            .await?;

        Ok(result.rows_affected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::database::connect_database_at_path;

    async fn test_db() -> DatabaseConnection {
        let path = std::env::temp_dir().join(format!("clipper_export_test_{}.sqlite3", uuid::Uuid::new_v4()));
        let local_db = connect_database_at_path(path).await.expect("connect test db");
        local_db.database
    }

    #[tokio::test]
    async fn patch_fill_missing_preserves_existing_fields() {
        let db = test_db().await;
        let exported_at = chrono::Utc::now().to_rfc3339();
        let input = ClipperExportUpsertInput {
            id: "export-1".into(),
            clip_index: 0,
            format_id: "tiktok".into(),
            file_name: "clip.mp4".into(),
            relative_path: "clip.mp4".into(),
            width: 1080,
            height: 1920,
            file_size: 1000,
            exported_at: exported_at.clone(),
            clip_start_sec: None,
            clip_end_sec: None,
            transcript_plain: Some("hello world".into()),
            transcript_timestamped: None,
            social_title: Some("Existing title".into()),
            social_short_description: None,
            social_description: None,
            social_description_timestamped: None,
            social_hashtags: None,
        };
        ExportRepository::upsert(&db, "project-1", input).await.expect("upsert");

        let patched = ExportRepository::patch_social_metadata(
            &db,
            "export-1",
            ClipperExportSocialPatch {
                social_title: Some("New title".into()),
                social_short_description: Some("Short".into()),
                social_description: None,
                social_description_timestamped: None,
                social_hashtags: None,
            },
            SocialPatchMode::FillMissing,
        )
        .await
        .expect("patch");

        assert_eq!(patched.social_title, "Existing title");
        assert_eq!(patched.social_short_description, "Short");
    }

    #[tokio::test]
    async fn patch_overwrite_replaces_fields() {
        let db = test_db().await;
        let exported_at = chrono::Utc::now().to_rfc3339();
        let input = ClipperExportUpsertInput {
            id: "export-2".into(),
            clip_index: 0,
            format_id: "tiktok".into(),
            file_name: "clip.mp4".into(),
            relative_path: "clip.mp4".into(),
            width: 1080,
            height: 1920,
            file_size: 1000,
            exported_at,
            clip_start_sec: None,
            clip_end_sec: None,
            transcript_plain: Some("hello".into()),
            transcript_timestamped: None,
            social_title: Some("Old".into()),
            social_short_description: None,
            social_description: None,
            social_description_timestamped: None,
            social_hashtags: None,
        };
        ExportRepository::upsert(&db, "project-1", input).await.expect("upsert");

        let patched = ExportRepository::patch_social_metadata(
            &db,
            "export-2",
            ClipperExportSocialPatch {
                social_title: Some("New".into()),
                social_short_description: Some("".into()),
                social_description: None,
                social_description_timestamped: None,
                social_hashtags: None,
            },
            SocialPatchMode::Overwrite,
        )
        .await
        .expect("patch");

        assert_eq!(patched.social_title, "New");
        assert_eq!(patched.social_short_description, "");
    }
}

fn merge_social_field(
    existing: &str,
    patch: Option<String>,
    mode: SocialPatchMode,
) -> String {
    match patch {
        None => existing.to_string(),
        Some(value) => match mode {
            SocialPatchMode::Overwrite => value,
            SocialPatchMode::FillMissing => {
                if existing.trim().is_empty() {
                    value
                } else {
                    existing.to_string()
                }
            }
        },
    }
}

fn model_to_record(model: Model) -> ClipperExportRecord {
    ClipperExportRecord {
        id: model.id,
        project_id: model.project_id,
        clip_index: model.clip_index,
        format_id: model.format_id,
        file_name: model.file_name,
        relative_path: model.relative_path,
        width: model.width,
        height: model.height,
        file_size: model.file_size,
        clip_start_sec: model.clip_start_sec,
        clip_end_sec: model.clip_end_sec,
        exported_at: model.exported_at,
        transcript_plain: model.transcript_plain,
        transcript_timestamped: model.transcript_timestamped,
        social_title: model.social_title,
        social_short_description: model.social_short_description,
        social_description: model.social_description,
        social_description_timestamped: model.social_description_timestamped,
        social_hashtags: model.social_hashtags,
        created_at: model.created_at,
        updated_at: model.updated_at,
    }
}
