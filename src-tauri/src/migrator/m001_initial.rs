use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};

use super::{impl_migration, Migration};

pub struct M001Initial;

impl_migration!(M001Initial, 1, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    let statements = [
        "CREATE INDEX IF NOT EXISTS idx_local_projects_owner_updated ON local_projects(owner_id, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_local_projects_owner_type ON local_projects(owner_id, project_type)",
        "CREATE INDEX IF NOT EXISTS idx_local_records_project_namespace ON local_records(project_id, namespace)",
    ];

    for statement in statements {
        db.execute_unprepared(statement).await?;
    }

    Ok(())
}
