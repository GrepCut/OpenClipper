use std::{path::PathBuf, time::Duration};

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use tauri::{AppHandle, Manager};

use crate::storage::entity::{clipper_export, clipper_export_publish, clipper_owner, clipper_owner_channel, local_project, local_record, schema_migration};
use crate::storage::migrator::ManualMigrator;

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

    connect_database(path, 4).await
}

pub async fn connect_database_at_path(path: PathBuf) -> Result<LocalDb, DbErr> {
    connect_database(path, 2).await
}

async fn connect_database(path: PathBuf, max_connections: u32) -> Result<LocalDb, DbErr> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| DbErr::Custom(error.to_string()))?;
    }

    let database_url = format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );

    let mut options = ConnectOptions::new(database_url);
    options
        .max_connections(max_connections)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .connect_timeout(Duration::from_secs(5))
        .acquire_timeout(Duration::from_secs(30))
        .map_sqlx_sqlite_opts(|options| {
            options.pragma("journal_mode", "WAL").busy_timeout(Duration::from_secs(10))
        });

    let database = Database::connect(options).await?;
    synchronize_schema(&database).await?;
    ManualMigrator::run(&database).await?;

    Ok(LocalDb { database, path })
}

pub fn default_database_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.openclipper.app")
        .join("clipper.sqlite3")
}

async fn synchronize_schema(database: &DatabaseConnection) -> Result<(), DbErr> {
    database
        .get_schema_builder()
        .register(clipper_export::Entity)
        .register(clipper_export_publish::Entity)
        .register(clipper_owner::Entity)
        .register(clipper_owner_channel::Entity)
        .register(local_project::Entity)
        .register(local_record::Entity)
        .register(schema_migration::Entity)
        .sync(database)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};
    use crate::storage::repository::RecordRepository;

    #[tokio::test]
    async fn desktop_and_mcp_connections_share_wal_and_survive_concurrent_writes() {
        let path = std::env::temp_dir().join(format!("clipper-contention-{}.sqlite3", uuid::Uuid::new_v4()));
        let desktop = connect_database(path.clone(), 4).await.unwrap();
        let mcp = connect_database_at_path(path.clone()).await.unwrap();
        for db in [&desktop.database, &mcp.database] {
            let row = db.query_one_raw(Statement::from_string(DbBackend::Sqlite, "PRAGMA journal_mode")).await.unwrap().unwrap();
            assert_eq!(row.try_get::<String>("", "journal_mode").unwrap().to_lowercase(), "wal");
            let row = db.query_one_raw(Statement::from_string(DbBackend::Sqlite, "PRAGMA busy_timeout")).await.unwrap().unwrap();
            assert_eq!(row.try_get::<i64>("", "timeout").unwrap(), 10_000);
        }
        let mut tasks = Vec::new();
        for index in 0..100 {
            let db = if index % 2 == 0 { desktop.database.clone() } else { mcp.database.clone() };
            tasks.push(tokio::spawn(async move {
                RecordRepository::put(&db, "contention".into(), index.to_string(), None, serde_json::json!({"index": index})).await.unwrap();
            }));
        }
        for task in tasks { task.await.unwrap(); }

        // Hold a real SQLite write lock, then release it while the second pool waits.
        let transaction = desktop.database.begin().await.unwrap();
        transaction.execute_raw(Statement::from_string(DbBackend::Sqlite, "UPDATE local_records SET updated_at = 'held' WHERE namespace = 'contention'")).await.unwrap();
        let db = mcp.database.clone();
        let waiting = tokio::spawn(async move {
            RecordRepository::put(&db, "contention".into(), "waiting".into(), None, serde_json::json!(true)).await
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        transaction.commit().await.unwrap();
        waiting.await.unwrap().unwrap();
        desktop.database.close().await.unwrap();
        mcp.database.close().await.unwrap();
        std::fs::remove_file(path).unwrap();
    }
}
