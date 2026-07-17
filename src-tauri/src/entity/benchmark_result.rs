use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[sea_orm(table_name = "benchmark_results")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub run_id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub clip_id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub aspect_id: String,
    #[sea_orm(column_type = "Text")]
    pub status: String,
    #[sea_orm(column_type = "Json")]
    pub metrics_json: Json,
    #[sea_orm(column_type = "Text")]
    pub details_relative_path: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub error: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
