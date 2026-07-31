use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "clipper_exports")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub project_id: String,
    pub clip_index: i32,
    #[sea_orm(column_type = "Text")]
    pub format_id: String,
    #[sea_orm(column_type = "Text")]
    pub file_name: String,
    #[sea_orm(column_type = "Text")]
    pub relative_path: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub clip_start_sec: Option<f64>,
    pub clip_end_sec: Option<f64>,
    #[sea_orm(column_type = "Text")]
    pub exported_at: String,
    #[sea_orm(column_type = "Text")]
    pub transcript_plain: String,
    #[sea_orm(column_type = "Text")]
    pub transcript_timestamped: String,
    #[sea_orm(column_type = "Text")]
    pub social_title: String,
    #[sea_orm(column_type = "Text")]
    pub social_short_description: String,
    #[sea_orm(column_type = "Text")]
    pub social_description: String,
    #[sea_orm(column_type = "Text")]
    pub social_description_timestamped: String,
    #[sea_orm(column_type = "Text")]
    pub social_hashtags: String,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
