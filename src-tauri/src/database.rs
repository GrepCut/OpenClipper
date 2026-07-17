use std::{path::PathBuf, time::Duration};

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use tauri::{AppHandle, Manager};

use crate::entity::{
    benchmark_result, benchmark_run, local_project, local_record, schema_migration, test_clip,
    test_dataset, test_keyframe, test_target,
};
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
        .register(test_dataset::Entity)
        .register(test_clip::Entity)
        .register(test_keyframe::Entity)
        .register(test_target::Entity)
        .register(benchmark_run::Entity)
        .register(benchmark_result::Entity)
        .sync(database)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::test_clip;
    use crate::repository::test_repository::{TestKeyframeDto, TestTargetDto};
    use crate::repository::{ProjectRepository, RecordRepository, TestRepository};
    use sea_orm::{ConnectionTrait, Set, Statement};
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

        for table in [
            "local_schema_migrations",
            "local_projects",
            "local_records",
            "test_datasets",
            "test_clips",
            "test_keyframes",
            "test_targets",
            "benchmark_runs",
            "benchmark_results",
        ] {
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

    #[tokio::test]
    async fn test_dataset_annotations_and_immutable_run_roundtrip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("clipper.sqlite3");
        let database = open_test_database(&db_path).await;
        synchronize_schema(&database).await.expect("schema sync");
        ManualMigrator::run(&database).await.expect("migrate");

        TestRepository::create_dataset(
            &database,
            "dataset-1".into(),
            "Reference".into(),
            None,
        )
        .await
        .expect("create dataset");
        let now = "2026-01-01T00:00:00Z".to_string();
        TestRepository::insert_clip(
            &database,
            test_clip::ActiveModel {
                id: Set("clip-1".into()),
                dataset_id: Set("dataset-1".into()),
                name: Set("Clip".into()),
                original_file_name: Set("source.mp4".into()),
                media_relative_path: Set("clips/clip-1/clip.mp4".into()),
                duration: Set(10.0),
                width: Set(1920),
                height: Set(1080),
                frame_rate: Set(30.0),
                sha256: Set("abc".into()),
                annotation_revision: Set(0),
                created_at: Set(now.clone()),
                updated_at: Set(now),
            },
        )
        .await
        .expect("create clip");

        let frames = vec![TestKeyframeDto {
            id: "frame-1".into(),
            timestamp_us: 1_000_000,
            targets: vec![TestTargetDto {
                id: "target-1".into(),
                slot: 0,
                x: 0.5,
                y: 0.4,
                radius: 0.1,
            }],
        }];
        let (revision, _) = TestRepository::replace_annotations(&database, "clip-1", frames)
            .await
            .expect("save annotations");
        assert_eq!(revision, 1);
        assert_eq!(TestRepository::annotations(&database, "clip-1").await.unwrap().len(), 1);

        TestRepository::create_run(
            &database,
            "run-1".into(),
            "dataset-1".into(),
            json!(["clip-1"]),
            json!({"analyzer": "production-smart-follow"}),
        )
        .await
        .expect("create run");
        TestRepository::finish_run(&database, "run-1", "completed".into(), None, None)
            .await
            .expect("finish run");
        assert!(TestRepository::finish_run(
            &database,
            "run-1",
            "failed".into(),
            None,
            None,
        )
        .await
        .is_err());
    }
}
