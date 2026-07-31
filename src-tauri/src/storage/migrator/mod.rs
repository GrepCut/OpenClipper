pub mod m001_initial;
pub mod m002_shared_workspace;
pub mod m003_clipper_exports;
pub mod m004_clipper_export_publishes;
pub mod m005_clipper_exports_manifest_sync;
pub mod m008_repair_clipper_export_publishes;
pub mod m009_clipper_owners;

use chrono::Utc;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, Statement};

use crate::storage::entity::schema_migration;

pub struct ManualMigrator;

impl ManualMigrator {
    pub async fn run(db: &DatabaseConnection) -> Result<(), DbErr> {
        let current = Self::current_version(db).await?;
        for migration in Self::migrations() {
            if migration.version() > current {
                migration.up(db).await?;
                Self::record_version(db, migration.version()).await?;
            }
        }
        Ok(())
    }

    fn migrations() -> Vec<Box<dyn Migration>> {
        vec![
            Box::new(m001_initial::M001Initial),
            Box::new(m002_shared_workspace::M002SharedWorkspace),
            Box::new(m003_clipper_exports::M003ClipperExports),
            Box::new(m004_clipper_export_publishes::M004ClipperExportPublishes),
            Box::new(m005_clipper_exports_manifest_sync::M005ClipperExportsManifestSync),
            Box::new(m008_repair_clipper_export_publishes::M008RepairClipperExportPublishes),
            Box::new(m009_clipper_owners::M009ClipperOwners),
        ]
    }

    async fn current_version(db: &DatabaseConnection) -> Result<i32, DbErr> {
        if !Self::table_exists(db, "local_schema_migrations").await? {
            return Ok(0);
        }

        Ok(schema_migration::Entity::find()
            .all(db)
            .await?
            .into_iter()
            .map(|row| row.version)
            .max()
            .unwrap_or(0))
    }

    async fn record_version(db: &DatabaseConnection, version: i32) -> Result<(), DbErr> {
        let applied_at = Utc::now().to_rfc3339();
        db.execute_raw(Statement::from_sql_and_values(
            db.get_database_backend(),
            "INSERT OR IGNORE INTO local_schema_migrations(version, applied_at) VALUES (?, ?)",
            [version.into(), applied_at.into()],
        ))
        .await?;
        Ok(())
    }

    async fn table_exists(db: &DatabaseConnection, table_name: &str) -> Result<bool, DbErr> {
        let row = db
            .query_one_raw(Statement::from_sql_and_values(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                [table_name.into()],
            ))
            .await?;
        Ok(row.is_some())
    }
}

pub trait Migration: Send + Sync {
    fn version(&self) -> i32;
    fn up<'life0, 'async_trait>(
        &'life0 self,
        db: &'life0 DatabaseConnection,
    ) -> core::pin::Pin<
        Box<dyn core::future::Future<Output = Result<(), DbErr>> + Send + 'async_trait>,
    >
    where
        'life0: 'async_trait;
}

macro_rules! impl_migration {
    ($migration:ty, $version:expr, $body:expr) => {
        impl Migration for $migration {
            fn version(&self) -> i32 {
                $version
            }

            fn up<'life0, 'async_trait>(
                &'life0 self,
                db: &'life0 DatabaseConnection,
            ) -> core::pin::Pin<
                Box<dyn core::future::Future<Output = Result<(), DbErr>> + Send + 'async_trait>,
            >
            where
                'life0: 'async_trait,
            {
                Box::pin(async move { ($body)(db).await })
            }
        }
    };
}

pub(crate) use impl_migration;
