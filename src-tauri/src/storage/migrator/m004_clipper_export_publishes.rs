use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};

use super::{impl_migration, Migration};

pub struct M004ClipperExportPublishes;

impl_migration!(M004ClipperExportPublishes, 4, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    db.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS clipper_export_publishes (
            id TEXT PRIMARY KEY NOT NULL,
            export_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            status TEXT NOT NULL,
            job_id TEXT,
            external_id TEXT,
            watch_url TEXT,
            error_message TEXT,
            published_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;

    db.execute_unprepared(
        "CREATE INDEX IF NOT EXISTS idx_clipper_export_publishes_export_id ON clipper_export_publishes(export_id)",
    )
    .await?;

    Ok(())
}
