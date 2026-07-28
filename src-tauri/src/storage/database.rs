use std::{path::PathBuf, time::Duration};

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use tauri::{AppHandle, Manager};

use crate::storage::entity::{local_project, local_record, schema_migration};
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

async fn synchronize_schema(database: &DatabaseConnection) -> Result<(), DbErr> {
    database
        .get_schema_builder()
        .register(local_project::Entity)
        .register(local_record::Entity)
        .register(schema_migration::Entity)
        .sync(database)
        .await
}
