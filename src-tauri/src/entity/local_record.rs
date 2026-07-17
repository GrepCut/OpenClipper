use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "local_records")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_type = "Text")]
    pub namespace: String,
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_type = "Text")]
    pub record_key: String,
    #[sea_orm(indexed, column_type = "Text")]
    pub project_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub payload_json: Json,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
    #[sea_orm(
        belongs_to,
        from = "project_id",
        to = "id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub project: HasOne<super::local_project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
