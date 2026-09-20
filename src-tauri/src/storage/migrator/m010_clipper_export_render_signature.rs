use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, Statement};

use super::{impl_migration, Migration};

pub struct M010ClipperExportRenderSignature;

impl_migration!(M010ClipperExportRenderSignature, 10, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    let column = db
        .query_one_raw(Statement::from_string(
            db.get_database_backend(),
            "SELECT name FROM pragma_table_info('clipper_exports') WHERE name = 'render_signature'",
        ))
        .await?;
    if column.is_none() {
        db.execute_unprepared("ALTER TABLE clipper_exports ADD COLUMN render_signature TEXT")
            .await?;
    }

    db.execute_unprepared(
        "CREATE INDEX IF NOT EXISTS idx_clipper_exports_render_signature ON clipper_exports(project_id, format_id, render_signature)",
    )
    .await?;

    Ok(())
}
