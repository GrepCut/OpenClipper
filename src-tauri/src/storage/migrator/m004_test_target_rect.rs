use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, Statement};

use super::{impl_migration, Migration};

pub struct M004TestTargetRect;

impl_migration!(M004TestTargetRect, 4, up);

const LEGACY_TARGET_COLUMNS: &[&str] = &["radius", "center_x", "center_y"];

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    for column in LEGACY_TARGET_COLUMNS {
        if column_exists(db, "test_targets", column).await? {
            db.execute_unprepared(&format!("ALTER TABLE test_targets DROP COLUMN {column}"))
                .await?;
        }
    }
    Ok(())
}

async fn column_exists(db: &DatabaseConnection, table: &str, column: &str) -> Result<bool, DbErr> {
    let rows = db
        .query_all_raw(Statement::from_string(
            db.get_database_backend(),
            format!("PRAGMA table_info({table})"),
        ))
        .await?;
    for row in rows {
        let name: String = row.try_get("", "name")?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}
