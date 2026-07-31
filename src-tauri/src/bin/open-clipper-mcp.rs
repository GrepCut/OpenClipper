use std::path::PathBuf;
use std::sync::Arc;

use tauri_app_lib::mcp::run_stdio_server;
use tauri_app_lib::storage::database::{connect_database_at_path, default_database_path};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let path = std::env::var("OPEN_CLIPPER_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_database_path());

    let local_db = connect_database_at_path(path).await?;
    let database = Arc::new(local_db.database);
    run_stdio_server(database).await?;
    Ok(())
}
