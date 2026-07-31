use std::collections::HashMap;

use sea_orm::DatabaseConnection;

use crate::infra::error::DbResult;
use crate::storage::export_social_util::{format_label, format_platform, missing_social_fields, publish_platform};
use crate::storage::repository::export_publish_repository::{
    ClipperExportPublishRecord, ExportPublishRepository,
};
use crate::storage::repository::export_repository::ExportRepository;
use crate::storage::repository::owner_repository::OwnerRepository;
use crate::storage::repository::project_repository::ProjectRepository;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportMapItem {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub clipper_owner_id: Option<String>,
    pub clipper_owner_name: Option<String>,
    pub clip_index: i32,
    pub format_id: String,
    pub platform: String,
    pub format_label: String,
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
    pub missing_fields: Vec<String>,
    pub has_transcript: bool,
    pub publish_status: Option<ClipperExportPublishRecord>,
    pub is_published: bool,
}

pub struct ExportMapRepository;

impl ExportMapRepository {
    pub async fn list_all(
        database: &DatabaseConnection,
        project_id: Option<&str>,
    ) -> DbResult<Vec<ClipperExportMapItem>> {
        let exports = ExportRepository::list_all(database, project_id).await?;

        let project_summaries =
            ProjectRepository::list_summaries(database, Some("clipper")).await?;
        let project_names: HashMap<String, String> = project_summaries
            .into_iter()
            .map(|summary| (summary.id, summary.name))
            .collect();
        let project_owner_map = OwnerRepository::project_owner_map(database).await?;
        let owner_names = OwnerRepository::owner_names_by_id(database).await?;

        let export_ids: Vec<String> = exports.iter().map(|row| row.id.clone()).collect();
        let publish_rows = ExportPublishRepository::latest_by_export_ids(database, &export_ids)
            .await
            .unwrap_or_else(|error| {
                log::warn!("export map: publish status lookup failed: {error}");
                vec![]
            });
        let publish_by_export_platform: HashMap<(String, String), ClipperExportPublishRecord> =
            publish_rows
                .into_iter()
                .map(|row| ((row.export_id.clone(), row.platform.clone()), row))
                .collect();

        Ok(exports
            .into_iter()
            .map(|record| {
                let platform = format_platform(&record.format_id).to_string();
                let publish_platform_key = publish_platform(&record.format_id).to_string();
                let publish_status = publish_by_export_platform
                    .get(&(record.id.clone(), publish_platform_key.clone()))
                    .cloned();
                let is_published = publish_status
                    .as_ref()
                    .map(|row| row.status == "succeeded")
                    .unwrap_or(false);
                let project_name = project_names
                    .get(&record.project_id)
                    .cloned()
                    .unwrap_or_else(|| record.project_id.clone());
                let clipper_owner_id = project_owner_map.get(&record.project_id).cloned();
                let clipper_owner_name = clipper_owner_id
                    .as_ref()
                    .and_then(|owner_id| owner_names.get(owner_id).cloned());
                let missing_fields = missing_social_fields(&record);
                let has_transcript = !record.transcript_plain.trim().is_empty();

                let format_label_str = format_label(&record.format_id).to_string();

                ClipperExportMapItem {
                    id: record.id,
                    project_id: record.project_id,
                    project_name,
                    clipper_owner_id,
                    clipper_owner_name,
                    clip_index: record.clip_index,
                    format_id: record.format_id,
                    platform,
                    format_label: format_label_str,
                    file_name: record.file_name,
                    relative_path: record.relative_path,
                    width: record.width,
                    height: record.height,
                    file_size: record.file_size,
                    clip_start_sec: record.clip_start_sec,
                    clip_end_sec: record.clip_end_sec,
                    exported_at: record.exported_at,
                    transcript_plain: record.transcript_plain,
                    transcript_timestamped: record.transcript_timestamped,
                    social_title: record.social_title,
                    social_short_description: record.social_short_description,
                    social_description: record.social_description,
                    social_description_timestamped: record.social_description_timestamped,
                    social_hashtags: record.social_hashtags,
                    created_at: record.created_at,
                    updated_at: record.updated_at,
                    missing_fields,
                    has_transcript,
                    publish_status,
                    is_published,
                }
            })
            .collect())
    }
}
