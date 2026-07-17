use std::{path::PathBuf, time::Duration};

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use tauri::{AppHandle, Manager};

use crate::entity::{local_project, local_record, schema_migration};
use crate::migrator::ManualMigrator;

#[derive(Clone)]
pub struct LocalDb {
    pub database: DatabaseConnection,
    pub path: PathBuf,
}

pub async fn initialize_database(app: &AppHandle) -> Result<LocalDb, DbErr> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| DbErr::Custom(error.to_string()))?;
    std::fs::create_dir_all(&app_data).map_err(|error| DbErr::Custom(error.to_string()))?;
    let path = app_data.join("clipper.sqlite3");

    let database_url = format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );

    let mut options = ConnectOptions::new(database_url);
    options
        .max_connections(4)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .connect_timeout(Duration::from_secs(5))
        .acquire_timeout(Duration::from_secs(5));

    let database = Database::connect(options).await?;
    synchronize_schema(&database).await?;
    ManualMigrator::run(&database).await?;

    Ok(LocalDb { database, path })
}

async fn synchronize_schema(database: &DatabaseConnection) -> Result<(), DbErr> {
    database
        .get_schema_builder()
        .register(local_project::Entity)
        .register(local_record::Entity)
        .register(schema_migration::Entity)
        .sync(database)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::{ProjectRepository, RecordRepository};
    use sea_orm::{ConnectionTrait, Statement};
    use serde_json::json;
    use tempfile::tempdir;

    async fn open_test_database(path: &std::path::Path) -> DatabaseConnection {
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            path.to_string_lossy().replace('\\', "/")
        );
        Database::connect(ConnectOptions::new(database_url))
            .await
            .expect("connect test database")
    }

    #[tokio::test]
    async fn migrator_and_schema_sync_create_tables() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("clipper.sqlite3");
        let database = open_test_database(&db_path).await;

        synchronize_schema(&database).await.expect("schema sync");
        ManualMigrator::run(&database)
            .await
            .expect("manual migrator");

        for table in ["local_schema_migrations", "local_projects", "local_records"] {
            let row = database
                .query_one_raw(Statement::from_sql_and_values(
                    database.get_database_backend(),
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                    [table.into()],
                ))
                .await
                .expect("query table");
            assert!(row.is_some(), "missing table {table}");
        }
    }

    #[tokio::test]
    async fn project_and_record_roundtrip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("clipper.sqlite3");
        let database = open_test_database(&db_path).await;
        synchronize_schema(&database).await.expect("schema sync");
        ManualMigrator::run(&database)
            .await
            .expect("manual migrator");

        let project = json!({
            "id": "project-1",
            "name": "Demo",
            "description": "Test project",
            "projectType": "clipper",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z"
        });

        ProjectRepository::put(&database, "owner-1", project.clone())
            .await
            .expect("put project");
        let loaded = ProjectRepository::get(&database, "project-1", "owner-1")
            .await
            .expect("get project")
            .expect("project exists");
        assert_eq!(loaded, project);

        let record = json!({ "steps": ["transcribe"] });
        RecordRepository::put(
            &database,
            "clipper-pipeline-steps".into(),
            "project-1".into(),
            Some("project-1".into()),
            record.clone(),
        )
        .await
        .expect("put record");
        let loaded_record = RecordRepository::get(
            &database,
            "clipper-pipeline-steps".into(),
            "project-1".into(),
        )
        .await
        .expect("get record")
        .expect("record exists");
        assert_eq!(loaded_record, record);
    }

    #[tokio::test]
    async fn migration_moves_existing_projects_to_shared_workspace() {
        use crate::migrator::m002_shared_workspace::SHARED_WORKSPACE_OWNER_ID;

        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("clipper.sqlite3");
        let database = open_test_database(&db_path).await;
        synchronize_schema(&database).await.expect("schema sync");

        let project = json!({
            "id": "legacy-project",
            "name": "Legacy",
            "projectType": "clipper",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z"
        });
        ProjectRepository::put(&database, "legacy-user", project.clone())
            .await
            .expect("put legacy project");

        ManualMigrator::run(&database).await.expect("run migrations");

        assert!(ProjectRepository::get(&database, "legacy-project", "legacy-user")
            .await
            .expect("query legacy owner")
            .is_none());
        assert_eq!(
            ProjectRepository::get(
                &database,
                "legacy-project",
                SHARED_WORKSPACE_OWNER_ID,
            )
            .await
            .expect("query shared owner"),
            Some(project),
        );
    }
}
