use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "local_projects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub owner_id: String,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub description: Option<String>,
    #[sea_orm(default_value = "clipper", indexed, column_type = "Text")]
    pub project_type: String,
    #[sea_orm(column_type = "Text")]
    pub payload_json: Json,
    #[sea_orm(indexed, column_type = "Text")]
    pub created_at: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub updated_at: String,
    #[sea_orm(indexed, column_type = "Text", nullable)]
    pub clipper_owner_id: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
