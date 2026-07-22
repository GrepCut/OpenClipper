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

async fn table_has_column(database: &DatabaseConnection, table: &str, column: &str) -> bool {
    let rows = database
        .query_all_raw(Statement::from_string(
            database.get_database_backend(),
            format!("PRAGMA table_info({table})"),
        ))
        .await
        .expect("table info");
    rows.into_iter()
        .any(|row| row.try_get::<String>("", "name").ok().as_deref() == Some(column))
}

#[tokio::test]
async fn schema_sync_upgrades_legacy_database_without_cohort_columns() {
    let dir = tempdir().expect("tempdir");
    let database = open_test_database(&dir.path().join("clipper.sqlite3")).await;
    database
        .execute_unprepared(
            "CREATE TABLE test_datasets (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )",
        )
        .await
        .expect("legacy test_datasets");
    database
        .execute_unprepared(
            "CREATE TABLE test_clips (
                    id TEXT PRIMARY KEY NOT NULL,
                    dataset_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    original_file_name TEXT NOT NULL,
                    media_relative_path TEXT NOT NULL,
                    duration REAL NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    frame_rate REAL NOT NULL,
                    sha256 TEXT NOT NULL,
                    annotation_revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )",
        )
        .await
        .expect("legacy test_clips");
    database
        .execute_unprepared(
            "INSERT INTO test_datasets (id, name, description, created_at, updated_at)
                 VALUES ('dataset-1', 'test1', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .await
        .expect("seed dataset");
    database
        .execute_unprepared(
            "INSERT INTO test_clips (
                    id, dataset_id, name, original_file_name, media_relative_path,
                    duration, width, height, frame_rate, sha256, annotation_revision,
                    created_at, updated_at
                 ) VALUES (
                    'clip-1', 'dataset-1', 'Spring (Blender)', 'spring.mp4', 'clips/clip-1/clip.mp4',
                    10.0, 1920, 1080, 30.0, 'abc', 0,
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                 )",
        )
        .await
        .expect("seed clip");

    synchronize_schema(&database)
        .await
        .expect("schema sync on legacy database");
    ManualMigrator::run(&database)
        .await
        .expect("manual migrator on legacy database");

    assert!(table_has_column(&database, "test_datasets", "dataset_role").await);
    assert!(table_has_column(&database, "test_clips", "cohort_tags_json").await);

    let role: String = database
        .query_one_raw(Statement::from_string(
            database.get_database_backend(),
            "SELECT dataset_role FROM test_datasets WHERE id = 'dataset-1'",
        ))
        .await
        .expect("query role")
        .expect("dataset row")
        .try_get("", "dataset_role")
        .expect("dataset_role value");
    assert_eq!(role, "tuning");

    let tags: String = database
        .query_one_raw(Statement::from_string(
            database.get_database_backend(),
            "SELECT cohort_tags_json FROM test_clips WHERE id = 'clip-1'",
        ))
        .await
        .expect("query tags")
        .expect("clip row")
        .try_get("", "cohort_tags_json")
        .expect("cohort_tags_json value");
    assert_eq!(tags, r#"["animation"]"#);
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
async fn migration_drops_legacy_test_target_radius_column() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("clipper.sqlite3");
    let database = open_test_database(&db_path).await;
    synchronize_schema(&database).await.expect("schema sync");
    database
        .execute_unprepared(
            "ALTER TABLE test_targets ADD COLUMN radius REAL NOT NULL DEFAULT 0.1",
        )
        .await
        .expect("add legacy radius column");
    ManualMigrator::run(&database).await.expect("migrate");

    let rows = database
        .query_all_raw(Statement::from_string(
            database.get_database_backend(),
            "PRAGMA table_info(test_targets)",
        ))
        .await
        .expect("table info");
    let names: Vec<String> = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").expect("column name"))
        .collect();
    assert!(!names.iter().any(|name| name == "radius"));
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
            cohort_tags_json: Set("[]".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        },
    )
    .await
    .expect("create clip");

    let frames = vec![TestKeyframeDto {
        id: "frame-1".into(),
        timestamp_us: 1_000_000,
        layout_intent: "crop".into(),
        targets: vec![TestTargetDto {
            id: "target-1".into(),
            slot: 0,
            x: 0.35,
            y: 0.1,
            width: 0.253125,
            height: 0.8,
        }],
    }];
    let (revision, _) = TestRepository::replace_annotations(&database, "clip-1", frames)
        .await
        .expect("save annotations");
    assert_eq!(revision, 1);
    assert_eq!(
        TestRepository::annotations(&database, "clip-1")
            .await
            .unwrap()
            .len(),
        1
    );

    let contain_frames = vec![TestKeyframeDto {
        id: "frame-contain".into(),
        timestamp_us: 2_000_000,
        layout_intent: "contain".into(),
        targets: vec![TestTargetDto {
            id: "target-contain".into(),
            slot: 0,
            x: 0.05,
            y: 0.1,
            width: 0.9,
            height: 0.75,
        }],
    }];
    let (_, saved) = TestRepository::replace_annotations(&database, "clip-1", contain_frames)
        .await
        .expect("save contain annotations");
    assert_eq!(saved[0].layout_intent, "contain");
    assert_eq!(saved[0].targets[0].width, 0.9);

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
    assert!(TestRepository::finish_run(&database, "run-1", "failed".into(), None, None)
        .await
        .is_err());
}
