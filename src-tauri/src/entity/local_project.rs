use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "local_projects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(indexed)]
    pub owner_id: String,
    pub name: String,
    pub description: Option<String>,
    #[sea_orm(default_value = "clipper", indexed)]
    pub project_type: String,
    #[sea_orm(column_type = "Text")]
    pub payload_json: Json,
    #[sea_orm(indexed)]
    pub created_at: String,
    #[sea_orm(indexed)]
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
