use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "local_schema_migrations")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub version: i32,
    #[sea_orm(column_type = "Text")]
    pub applied_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
