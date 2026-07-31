use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "clipper_export_publishes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub export_id: String,
    #[sea_orm(column_type = "Text")]
    pub platform: String,
    #[sea_orm(column_type = "Text")]
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub job_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub external_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub watch_url: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub error_message: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub published_at: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
