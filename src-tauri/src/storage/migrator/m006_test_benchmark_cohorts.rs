use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, Statement};

use super::{impl_migration, Migration};

pub struct M006TestBenchmarkCohorts;

impl_migration!(M006TestBenchmarkCohorts, 6, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    if !column_exists(db, "test_datasets", "dataset_role").await? {
        db.execute_unprepared(
            "ALTER TABLE test_datasets ADD COLUMN dataset_role TEXT NOT NULL DEFAULT 'tuning'",
        )
        .await?;
    }
    if !column_exists(db, "test_clips", "cohort_tags_json").await? {
        db.execute_unprepared(
            "ALTER TABLE test_clips ADD COLUMN cohort_tags_json TEXT NOT NULL DEFAULT '[]'",
        )
        .await?;
    }
    seed_test1_cohort_tags(db).await?;
    Ok(())
}

async fn seed_test1_cohort_tags(db: &DatabaseConnection) -> Result<(), DbErr> {
    let seeds: [(&str, &str); 9] = [
        ("mrbeast", r#"["multi-person-interview"]"#),
        ("interview", r#"["multi-person-interview"]"#),
        ("export_2026", r#"["talking-head"]"#),
        ("podcast", r#"["talking-head"]"#),
        ("super-bass", r#"["music-video"]"#),
        ("spring", r#"["animation"]"#),
        ("blender", r#"["animation"]"#),
        ("snowboard", r#"["sport-fast"]"#),
        ("medium", r#"["mixed"]"#),
    ];
    for (needle, tags) in seeds {
        db.execute_raw(Statement::from_sql_and_values(
            db.get_database_backend(),
            "UPDATE test_clips SET cohort_tags_json = ? \
             WHERE cohort_tags_json = '[]' AND lower(name) LIKE ?",
            [tags.into(), format!("%{needle}%").into()],
        ))
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
