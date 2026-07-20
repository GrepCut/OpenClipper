use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[sea_orm(table_name = "test_datasets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub description: Option<String>,
    #[sea_orm(default_value = "tuning", column_type = "Text")]
    pub dataset_role: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub created_at: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
