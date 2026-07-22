use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};

use super::{impl_migration, Migration};

pub const SHARED_WORKSPACE_OWNER_ID: &str = "open-clipper-local-workspace-v1";

pub struct M002SharedWorkspace;

impl_migration!(M002SharedWorkspace, 2, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    db.execute_unprepared(&format!(
        "UPDATE local_projects SET owner_id = '{}' WHERE owner_id <> '{}'",
        SHARED_WORKSPACE_OWNER_ID, SHARED_WORKSPACE_OWNER_ID
    ))
    .await?;
    Ok(())
}
