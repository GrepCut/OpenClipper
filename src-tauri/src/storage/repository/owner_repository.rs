use chrono::Utc;
use sea_orm::{
    sea_query::OnConflict, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::infra::error::{DbError, DbResult};
use crate::storage::entity::clipper_owner::{ActiveModel, Column, Entity, Model};
use crate::storage::entity::clipper_owner_channel;
use crate::storage::entity::local_project;

pub struct OwnerRepository;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperOwnerRecord {
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub channel_count: i64,
    pub project_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperOwnerUpsertInput {
    pub id: Option<String>,
    pub name: String,
    pub avatar_url: Option<String>,
    pub notes: Option<String>,
}

impl OwnerRepository {
    pub async fn list(database: &DatabaseConnection) -> DbResult<Vec<ClipperOwnerRecord>> {
        let rows = Entity::find()
            .order_by_asc(Column::Name)
            .all(database)
            .await?;
        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            records.push(Self::to_record(database, row).await?);
        }
        Ok(records)
    }

    pub async fn get_by_id(
        database: &DatabaseConnection,
        id: &str,
    ) -> DbResult<Option<ClipperOwnerRecord>> {
        let row = Entity::find_by_id(id.to_owned()).one(database).await?;
        match row {
            Some(model) => Ok(Some(Self::to_record(database, model).await?)),
            None => Ok(None),
        }
    }

    pub async fn upsert(
        database: &DatabaseConnection,
        input: ClipperOwnerUpsertInput,
    ) -> DbResult<ClipperOwnerRecord> {
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let existing = Entity::find_by_id(id.clone()).one(database).await?;
        let created_at = existing
            .as_ref()
            .map(|row| row.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let notes = input
            .notes
            .unwrap_or_else(|| existing.as_ref().map(|row| row.notes.clone()).unwrap_or_default());

        let active_model = ActiveModel {
            id: sea_orm::Set(id.clone()),
            name: sea_orm::Set(input.name),
            avatar_url: sea_orm::Set(input.avatar_url),
            notes: sea_orm::Set(notes),
            created_at: sea_orm::Set(created_at),
            updated_at: sea_orm::Set(now),
        };

        Entity::insert(active_model)
            .on_conflict(
                OnConflict::column(Column::Id)
                    .update_columns([
                        Column::Name,
                        Column::AvatarUrl,
                        Column::Notes,
                        Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec(database)
            .await?;

        Self::get_by_id(database, &id)
            .await?
            .ok_or_else(|| DbError::message("Owner upsert failed"))
    }

    pub async fn delete(database: &DatabaseConnection, id: &str) -> DbResult<()> {
        let project_count = local_project::Entity::find()
            .filter(local_project::Column::ClipperOwnerId.eq(id))
            .count(database)
            .await?;
        if project_count > 0 {
            return Err(DbError::message(
                "Cannot delete owner while projects are still assigned",
            ));
        }

        clipper_owner_channel::Entity::delete_many()
            .filter(clipper_owner_channel::Column::OwnerId.eq(id))
            .exec(database)
            .await?;

        Entity::delete_by_id(id.to_owned())
            .exec(database)
            .await?;
        Ok(())
    }

    pub async fn set_project_owner(
        database: &DatabaseConnection,
        project_id: &str,
        owner_id: Option<&str>,
    ) -> DbResult<()> {
        if let Some(owner_id) = owner_id {
            Entity::find_by_id(owner_id.to_owned())
                .one(database)
                .await?
                .ok_or_else(|| DbError::message("Owner not found"))?;
        }

        let row = local_project::Entity::find_by_id(project_id.to_owned())
            .one(database)
            .await?
            .ok_or_else(|| DbError::message("Project not found"))?;

        let mut active: local_project::ActiveModel = row.into();
        active.clipper_owner_id = sea_orm::Set(owner_id.map(str::to_owned));
        active.updated_at = sea_orm::Set(Utc::now().to_rfc3339());
        active.update(database).await?;
        Ok(())
    }

    pub async fn get_project_owner_id(
        database: &DatabaseConnection,
        project_id: &str,
    ) -> DbResult<Option<String>> {
        let row = local_project::Entity::find_by_id(project_id.to_owned())
            .one(database)
            .await?;
        Ok(row.and_then(|project| project.clipper_owner_id))
    }

    pub async fn owner_names_by_id(
        database: &DatabaseConnection,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let rows = Entity::find().all(database).await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.id, row.name))
            .collect())
    }

    pub async fn project_owner_map(
        database: &DatabaseConnection,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let rows = local_project::Entity::find()
            .filter(local_project::Column::ClipperOwnerId.is_not_null())
            .all(database)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| row.clipper_owner_id.map(|owner_id| (row.id, owner_id)))
            .collect())
    }

    async fn to_record(database: &DatabaseConnection, model: Model) -> DbResult<ClipperOwnerRecord> {
        let channel_count = clipper_owner_channel::Entity::find()
            .filter(clipper_owner_channel::Column::OwnerId.eq(model.id.clone()))
            .count(database)
            .await? as i64;
        let project_count = local_project::Entity::find()
            .filter(local_project::Column::ClipperOwnerId.eq(model.id.clone()))
            .count(database)
            .await? as i64;

        Ok(ClipperOwnerRecord {
            id: model.id,
            name: model.name,
            avatar_url: model.avatar_url,
            notes: model.notes,
            created_at: model.created_at,
            updated_at: model.updated_at,
            channel_count,
            project_count,
        })
    }
}
