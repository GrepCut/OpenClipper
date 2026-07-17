use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[sea_orm(table_name = "test_clips")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub dataset_id: String,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub original_file_name: String,
    #[sea_orm(column_type = "Text")]
    pub media_relative_path: String,
    pub duration: f64,
    pub width: i32,
    pub height: i32,
    pub frame_rate: f64,
    #[sea_orm(column_type = "Text")]
    pub sha256: String,
    pub annotation_revision: i32,
    #[sea_orm(indexed, column_type = "Text")]
    pub created_at: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
