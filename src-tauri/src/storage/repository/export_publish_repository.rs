use chrono::Utc;
use sea_orm::{
    sea_query::OnConflict, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::infra::error::DbResult;
use crate::storage::entity::clipper_export_publish::{ActiveModel, Column, Entity, Model};

pub struct ExportPublishRepository;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublishStatus {
    Pending,
    Succeeded,
    Failed,
}

impl PublishStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PublishStatus::Pending => "pending",
            PublishStatus::Succeeded => "succeeded",
            PublishStatus::Failed => "failed",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "succeeded" => PublishStatus::Succeeded,
            "failed" => PublishStatus::Failed,
            _ => PublishStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportPublishRecord {
    pub id: String,
    pub export_id: String,
    pub platform: String,
    pub status: String,
    pub job_id: Option<String>,
    pub external_id: Option<String>,
    pub watch_url: Option<String>,
    pub error_message: Option<String>,
    pub published_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportPublishUpsertInput {
    pub export_id: String,
    pub platform: String,
    pub status: String,
    pub job_id: Option<String>,
    pub external_id: Option<String>,
    pub watch_url: Option<String>,
    pub error_message: Option<String>,
    pub published_at: Option<String>,
}

impl ExportPublishRepository {
    pub async fn upsert(
        database: &DatabaseConnection,
        input: ClipperExportPublishUpsertInput,
    ) -> DbResult<ClipperExportPublishRecord> {
        let now = Utc::now().to_rfc3339();
        let status = PublishStatus::from_str(&input.status).as_str().to_string();

        let existing = Entity::find()
            .filter(Column::ExportId.eq(&input.export_id))
            .filter(Column::Platform.eq(&input.platform))
            .order_by_desc(Column::UpdatedAt)
            .one(database)
            .await?;

        let id = existing
            .as_ref()
            .map(|row| row.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = existing
            .as_ref()
            .map(|row| row.created_at.clone())
            .unwrap_or_else(|| now.clone());

        let published_at = if status == "succeeded" {
            input
                .published_at
                .or_else(|| Some(now.clone()))
        } else {
            None
        };

        let active_model = ActiveModel {
            id: sea_orm::Set(id.clone()),
            export_id: sea_orm::Set(input.export_id.clone()),
            platform: sea_orm::Set(input.platform.clone()),
            status: sea_orm::Set(status),
            job_id: sea_orm::Set(input.job_id),
            external_id: sea_orm::Set(input.external_id),
            watch_url: sea_orm::Set(input.watch_url),
            error_message: sea_orm::Set(input.error_message),
            published_at: sea_orm::Set(published_at),
            created_at: sea_orm::Set(created_at),
            updated_at: sea_orm::Set(now),
        };

        Entity::insert(active_model)
            .on_conflict(
                OnConflict::column(Column::Id)
                    .update_columns([
                        Column::Status,
                        Column::JobId,
                        Column::ExternalId,
                        Column::WatchUrl,
                        Column::ErrorMessage,
                        Column::PublishedAt,
                        Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec(database)
            .await?;

        let row = Entity::find_by_id(id)
            .one(database)
            .await?
            .expect("clipper_export_publish row missing after upsert");

        Ok(model_to_record(row))
    }

    pub async fn list_by_export_id(
        database: &DatabaseConnection,
        export_id: &str,
    ) -> DbResult<Vec<ClipperExportPublishRecord>> {
        let rows = Entity::find()
            .filter(Column::ExportId.eq(export_id))
            .order_by_desc(Column::UpdatedAt)
            .all(database)
            .await?;
        Ok(rows.into_iter().map(model_to_record).collect())
    }

    pub async fn latest_by_export_ids(
        database: &DatabaseConnection,
        export_ids: &[String],
    ) -> DbResult<Vec<ClipperExportPublishRecord>> {
        if export_ids.is_empty() {
            return Ok(vec![]);
        }

        let rows = Entity::find()
            .filter(Column::ExportId.is_in(export_ids.iter().map(String::clone)))
            .order_by_desc(Column::UpdatedAt)
            .all(database)
            .await?;

        let mut latest: std::collections::HashMap<(String, String), ClipperExportPublishRecord> =
            std::collections::HashMap::new();

        for row in rows {
            let record = model_to_record(row);
            let key = (record.export_id.clone(), record.platform.clone());
            if !latest.contains_key(&key) {
                latest.insert(key, record);
            }
        }

        Ok(latest.into_values().collect())
    }

    pub async fn delete_by_export_ids(
        database: &DatabaseConnection,
        export_ids: &[String],
    ) -> DbResult<u64> {
        if export_ids.is_empty() {
            return Ok(0);
        }

        let result = Entity::delete_many()
            .filter(Column::ExportId.is_in(export_ids.iter().map(String::clone)))
            .exec(database)
            .await?;

        Ok(result.rows_affected)
    }
}

fn model_to_record(model: Model) -> ClipperExportPublishRecord {
    ClipperExportPublishRecord {
        id: model.id,
        export_id: model.export_id,
        platform: model.platform,
        status: model.status,
        job_id: model.job_id,
        external_id: model.external_id,
        watch_url: model.watch_url,
        error_message: model.error_message,
        published_at: model.published_at,
        created_at: model.created_at,
        updated_at: model.updated_at,
    }
}
