use tauri::State;

use crate::storage::database::LocalDb;
use crate::storage::repository::owner_channel_repository::{
    ClipperOwnerChannelRecord, ClipperOwnerChannelUpsertInput, OwnerChannelRepository,
};
use crate::storage::repository::owner_repository::{
    ClipperOwnerRecord, ClipperOwnerUpsertInput, OwnerRepository,
};

#[tauri::command]
pub async fn clipper_owners_list(
    db: State<'_, LocalDb>,
) -> Result<Vec<ClipperOwnerRecord>, String> {
    OwnerRepository::list(&db.database)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_owner_get(
    db: State<'_, LocalDb>,
    owner_id: String,
) -> Result<ClipperOwnerRecord, String> {
    OwnerRepository::get_by_id(&db.database, &owner_id)
        .await
        .map_err(|error: crate::infra::error::DbError| error.to_string())?
        .ok_or_else(|| format!("Owner not found: {owner_id}"))
}

#[tauri::command]
pub async fn clipper_owner_upsert(
    db: State<'_, LocalDb>,
    owner: ClipperOwnerUpsertInput,
) -> Result<ClipperOwnerRecord, String> {
    OwnerRepository::upsert(&db.database, owner)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_owner_delete(
    db: State<'_, LocalDb>,
    owner_id: String,
) -> Result<(), String> {
    OwnerRepository::delete(&db.database, &owner_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_owner_channels_list(
    db: State<'_, LocalDb>,
    owner_id: String,
) -> Result<Vec<ClipperOwnerChannelRecord>, String> {
    OwnerChannelRepository::list_by_owner(&db.database, &owner_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_owner_channel_upsert(
    db: State<'_, LocalDb>,
    channel: ClipperOwnerChannelUpsertInput,
) -> Result<ClipperOwnerChannelRecord, String> {
    OwnerChannelRepository::upsert(&db.database, channel)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_owner_channel_delete(
    db: State<'_, LocalDb>,
    channel_id: String,
) -> Result<(), String> {
    OwnerChannelRepository::delete(&db.database, &channel_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_project_set_owner(
    db: State<'_, LocalDb>,
    project_id: String,
    owner_id: Option<String>,
) -> Result<(), String> {
    OwnerRepository::set_project_owner(
        &db.database,
        &project_id,
        owner_id.as_deref(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_owner_projects_list(
    db: State<'_, LocalDb>,
    owner_id: String,
) -> Result<Vec<crate::storage::repository::project_repository::ProjectSummary>, String> {
    use crate::storage::entity::local_project;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

    let rows = local_project::Entity::find()
        .filter(local_project::Column::ClipperOwnerId.eq(owner_id))
        .order_by_desc(local_project::Column::UpdatedAt)
        .all(&db.database)
        .await
        .map_err(|error: sea_orm::DbErr| error.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| crate::storage::repository::project_repository::ProjectSummary {
            id: row.id,
            name: row.name,
            project_type: row.project_type,
        })
        .collect())
}
