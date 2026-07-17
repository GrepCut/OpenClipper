use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[sea_orm(table_name = "test_targets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub keyframe_id: String,
    #[sea_orm(indexed)]
    pub slot: i32,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}

impl ActiveModelBehavior for ActiveModel {}
