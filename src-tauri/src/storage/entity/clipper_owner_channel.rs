use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "clipper_owner_channels")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub owner_id: String,
    #[sea_orm(column_type = "Text")]
    pub platform: String,
    #[sea_orm(column_type = "Text")]
    pub external_id: String,
    #[sea_orm(column_type = "Text")]
    pub display_name: String,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
