use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use tauri::AppHandle;

use crate::clipper::data::clipper_export_file_exists;
use crate::infra::error::DbResult;
use crate::storage::repository::{ExportPublishRepository, ExportRepository};

pub async fn delete_project_exports(
    database: &DatabaseConnection,
    project_id: &str,
) -> DbResult<u64> {
    let exports = ExportRepository::list_by_project(database, project_id).await?;
    let export_ids: Vec<String> = exports.into_iter().map(|row| row.id).collect();
    if export_ids.is_empty() {
        return Ok(0);
    }

    ExportPublishRepository::delete_by_export_ids(database, &export_ids).await?;
    ExportRepository::delete_by_ids(database, &export_ids).await
}

pub async fn purge_missing_on_disk(
    app: &AppHandle,
    database: &DatabaseConnection,
    project_id: Option<&str>,
) -> DbResult<usize> {
    let exports = ExportRepository::list_all(database, project_id).await?;
    let missing_ids: Vec<String> = exports
        .into_iter()
        .filter(|row| !clipper_export_file_exists(app, &row.project_id, &row.file_name))
        .map(|row| row.id)
        .collect();

    if missing_ids.is_empty() {
        return Ok(0);
    }

    ExportPublishRepository::delete_by_export_ids(database, &missing_ids).await?;
    let deleted = ExportRepository::delete_by_ids(database, &missing_ids).await?;
    Ok(deleted as usize)
}

pub async fn delete_orphaned_project_exports(database: &DatabaseConnection) -> DbResult<u64> {
    use crate::storage::entity::local_project::Column as ProjectColumn;
    use crate::storage::entity::local_project::Entity as ProjectEntity;

    let project_ids: Vec<String> = ProjectEntity::find()
        .filter(ProjectColumn::ProjectType.eq("clipper"))
        .all(database)
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect();

    let exports = ExportRepository::list_all(database, None).await?;
    let orphan_ids: Vec<String> = exports
        .into_iter()
        .filter(|row| !project_ids.contains(&row.project_id))
        .map(|row| row.id)
        .collect();

    if orphan_ids.is_empty() {
        return Ok(0);
    }

    ExportPublishRepository::delete_by_export_ids(database, &orphan_ids).await?;
    ExportRepository::delete_by_ids(database, &orphan_ids).await
}
