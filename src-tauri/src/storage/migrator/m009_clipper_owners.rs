use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};

use super::{impl_migration, Migration};

pub struct M009ClipperOwners;

impl_migration!(M009ClipperOwners, 9, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    db.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS clipper_owners (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT,
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;

    db.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS clipper_owner_channels (
            id TEXT PRIMARY KEY NOT NULL,
            owner_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            external_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;

    db.execute_unprepared(
        "CREATE INDEX IF NOT EXISTS idx_clipper_owner_channels_owner_id ON clipper_owner_channels(owner_id)",
    )
    .await?;

    db.execute_unprepared(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_clipper_owner_channels_owner_platform ON clipper_owner_channels(owner_id, platform)",
    )
    .await?;

    Ok(())
}
