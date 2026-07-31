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

pub async fn connect_database_at_path(path: PathBuf) -> Result<LocalDb, DbErr> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| DbErr::Custom(error.to_string()))?;
    }

    let database_url = format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );

    let mut options = ConnectOptions::new(database_url);
    options
        .max_connections(2)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .connect_timeout(Duration::from_secs(5))
        .acquire_timeout(Duration::from_secs(5));

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
