use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::storage::database::LocalDb;
use crate::storage::repository::{
    project_repository::ProjectListQuery, ProjectRepository, RecordRepository,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabaseInfo {
    path: String,
    sqlite_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectListQuery {
    pub owner_id: String,
    pub page: i64,
    pub limit: i64,
    pub search: Option<String>,
    pub project_type: Option<String>,
    pub sort_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProjectListResult {
    pub data: Vec<Value>,
    pub total: i64,
}

#[tauri::command]
pub async fn local_database_info(db: State<'_, LocalDb>) -> Result<LocalDatabaseInfo, String> {
    let sqlite_version = sqlite_version(&db.database).await?;
    Ok(LocalDatabaseInfo {
        path: db.path.to_string_lossy().into_owned(),
        sqlite_version,
    })
}

#[tauri::command]
pub async fn local_project_put(
    db: State<'_, LocalDb>,
    owner_id: String,
    project: Value,
) -> Result<Value, String> {
    ProjectRepository::put(&db.database, &owner_id, project)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn local_project_get(
    db: State<'_, LocalDb>,
    id: String,
    owner_id: String,
) -> Result<Option<Value>, String> {
    ProjectRepository::get(&db.database, &id, &owner_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn local_project_list(
    db: State<'_, LocalDb>,
    query: LocalProjectListQuery,
) -> Result<LocalProjectListResult, String> {
    let result = ProjectRepository::list(
        &db.database,
        ProjectListQuery {
            owner_id: query.owner_id,
            page: query.page,
            limit: query.limit,
            search: query.search,
            project_type: query.project_type,
            sort_by: query.sort_by,
        },
    )
    .await
    .map_err(|error: crate::infra::error::DbError| error.to_string())?;

    Ok(LocalProjectListResult {
        data: result.data,
        total: result.total,
    })
}

#[tauri::command]
pub async fn local_project_delete(
    db: State<'_, LocalDb>,
    id: String,
    owner_id: String,
) -> Result<(), String> {
    ProjectRepository::delete(&db.database, &id, &owner_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn local_record_get(
    db: State<'_, LocalDb>,
    namespace: String,
    key: String,
) -> Result<Option<Value>, String> {
    RecordRepository::get(&db.database, namespace, key)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn local_record_put(
    db: State<'_, LocalDb>,
    namespace: String,
    key: String,
    project_id: Option<String>,
    payload: Value,
) -> Result<Value, String> {
    RecordRepository::put(&db.database, namespace, key, project_id, payload)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn local_record_delete(
    db: State<'_, LocalDb>,
    namespace: String,
    key: String,
) -> Result<(), String> {
    RecordRepository::delete(&db.database, namespace, key)
        .await
        .map_err(Into::into)
}

async fn sqlite_version(database: &DatabaseConnection) -> Result<String, String> {
    let row = database
        .query_one_raw(Statement::from_string(
            database.get_database_backend(),
            "SELECT sqlite_version()".to_string(),
        ))
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "sqlite_version() returned no rows".to_string())?;

    row.try_get_by_index::<String>(0)
        .map_err(|error| error.to_string())
}
