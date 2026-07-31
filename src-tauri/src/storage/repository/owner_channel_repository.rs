use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::infra::error::DbResult;
use crate::storage::entity::clipper_owner_channel::{ActiveModel, Column, Entity, Model};

pub struct OwnerChannelRepository;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperOwnerChannelRecord {
    pub id: String,
    pub owner_id: String,
    pub platform: String,
    pub external_id: String,
    pub display_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperOwnerChannelUpsertInput {
    pub id: Option<String>,
    pub owner_id: String,
    pub platform: String,
    pub external_id: String,
    pub display_name: String,
}

impl OwnerChannelRepository {
    pub async fn list_by_owner(
        database: &DatabaseConnection,
        owner_id: &str,
    ) -> DbResult<Vec<ClipperOwnerChannelRecord>> {
        let rows = Entity::find()
            .filter(Column::OwnerId.eq(owner_id))
            .order_by_asc(Column::Platform)
            .all(database)
            .await?;
        Ok(rows.into_iter().map(model_to_record).collect())
    }

    pub async fn upsert(
        database: &DatabaseConnection,
        input: ClipperOwnerChannelUpsertInput,
    ) -> DbResult<ClipperOwnerChannelRecord> {
        let owner_id = input.owner_id.clone();
        let platform = input.platform.clone();
        let now = Utc::now().to_rfc3339();
        let existing = Entity::find()
            .filter(Column::OwnerId.eq(owner_id.clone()))
            .filter(Column::Platform.eq(platform.clone()))
            .one(database)
            .await?;

        if let Some(existing) = existing {
            let mut active: ActiveModel = existing.into();
            active.external_id = sea_orm::Set(input.external_id);
            active.display_name = sea_orm::Set(input.display_name);
            active.updated_at = sea_orm::Set(now);
            let updated = active.update(database).await?;
            return Ok(model_to_record(updated));
        }

        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let active_model = ActiveModel {
            id: sea_orm::Set(id),
            owner_id: sea_orm::Set(owner_id),
            platform: sea_orm::Set(platform),
            external_id: sea_orm::Set(input.external_id),
            display_name: sea_orm::Set(input.display_name),
            created_at: sea_orm::Set(now.clone()),
            updated_at: sea_orm::Set(now),
        };

        let inserted = active_model.insert(database).await?;
        Ok(model_to_record(inserted))
    }

    pub async fn delete(database: &DatabaseConnection, id: &str) -> DbResult<()> {
        Entity::delete_by_id(id.to_owned())
            .exec(database)
            .await?;
        Ok(())
    }
}

fn model_to_record(model: Model) -> ClipperOwnerChannelRecord {
    ClipperOwnerChannelRecord {
        id: model.id,
        owner_id: model.owner_id,
        platform: model.platform,
        external_id: model.external_id,
        display_name: model.display_name,
        created_at: model.created_at,
        updated_at: model.updated_at,
    }
}
