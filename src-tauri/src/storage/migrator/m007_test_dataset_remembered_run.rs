use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, Statement};

use super::{impl_migration, Migration};

pub struct M007TestDatasetRememberedRun;

impl_migration!(M007TestDatasetRememberedRun, 7, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    if !column_exists(db, "test_datasets", "remembered_run_id").await? {
        db.execute_unprepared("ALTER TABLE test_datasets ADD COLUMN remembered_run_id TEXT")
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
