use chrono::Utc;
use sea_orm::{sea_query::OnConflict, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde_json::Value;

use crate::infra::error::DbResult;
use crate::storage::entity::local_record::{ActiveModel, Column, Entity, Model};

pub struct RecordRepository;

impl RecordRepository {
    pub async fn get(
        database: &DatabaseConnection,
        namespace: String,
        key: String,
    ) -> DbResult<Option<Value>> {
        let row = Entity::find()
            .filter(Column::Namespace.eq(namespace))
            .filter(Column::RecordKey.eq(key))
            .one(database)
            .await?;

        row.map(model_to_value).transpose()
    }

    pub async fn put(
        database: &DatabaseConnection,
        namespace: String,
        key: String,
        project_id: Option<String>,
        payload: Value,
    ) -> DbResult<Value> {
        let active_model = ActiveModel {
            namespace: sea_orm::Set(namespace),
            record_key: sea_orm::Set(key),
            project_id: sea_orm::Set(project_id),
            payload_json: sea_orm::Set(payload.clone().into()),
            updated_at: sea_orm::Set(Utc::now().to_rfc3339()),
        };

        Entity::insert(active_model)
            .on_conflict(
                OnConflict::columns([Column::Namespace, Column::RecordKey])
                    .update_columns([Column::ProjectId, Column::PayloadJson, Column::UpdatedAt])
                    .to_owned(),
            )
            .exec(database)
            .await?;

        Ok(payload)
    }

    pub async fn delete(
        database: &DatabaseConnection,
        namespace: String,
        key: String,
    ) -> DbResult<()> {
        Entity::delete_many()
            .filter(Column::Namespace.eq(namespace))
            .filter(Column::RecordKey.eq(key))
            .exec(database)
            .await?;
        Ok(())
    }
}

fn model_to_value(model: Model) -> DbResult<Value> {
    Ok(model.payload_json.into())
}
