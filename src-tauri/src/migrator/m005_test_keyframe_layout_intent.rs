use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, Statement};

use super::{impl_migration, Migration};

pub struct M005TestKeyframeLayoutIntent;

impl_migration!(M005TestKeyframeLayoutIntent, 5, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    if !column_exists(db, "test_keyframes", "layout_intent").await? {
        db.execute_unprepared(
            "ALTER TABLE test_keyframes ADD COLUMN layout_intent TEXT NOT NULL DEFAULT 'crop'",
        )
        .await?;
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
