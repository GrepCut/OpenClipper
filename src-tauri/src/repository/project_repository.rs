use chrono::Utc;
use sea_orm::{
    sea_query::{Expr, OnConflict},
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use serde_json::Value;

use crate::entity::local_project::{ActiveModel, Column, Entity, Model};
use crate::error::{DbError, DbResult};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListQuery {
    pub owner_id: String,
    pub page: i64,
    pub limit: i64,
    pub search: Option<String>,
    pub project_type: Option<String>,
    pub sort_by: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResult {
    pub data: Vec<Value>,
    pub total: i64,
}

pub struct ProjectRepository;

impl ProjectRepository {
    pub async fn put(
        database: &DatabaseConnection,
        owner_id: &str,
        project: Value,
    ) -> DbResult<Value> {
        let id = value_string(&project, "id")
            .ok_or_else(|| DbError::message("Project id is required"))?;
        let name = value_string(&project, "name")
            .ok_or_else(|| DbError::message("Project name is required"))?;
        let description = value_string(&project, "description");
        let project_type =
            value_string(&project, "projectType").unwrap_or_else(|| "clipper".into());
        let created_at =
            value_string(&project, "createdAt").unwrap_or_else(|| Utc::now().to_rfc3339());
        let updated_at =
            value_string(&project, "updatedAt").unwrap_or_else(|| Utc::now().to_rfc3339());

        let active_model = ActiveModel {
            id: sea_orm::Set(id),
            owner_id: sea_orm::Set(owner_id.to_owned()),
            name: sea_orm::Set(name),
            description: sea_orm::Set(description),
            project_type: sea_orm::Set(project_type),
            payload_json: sea_orm::Set(project.clone().into()),
            created_at: sea_orm::Set(created_at),
            updated_at: sea_orm::Set(updated_at),
        };

        Entity::insert(active_model)
            .on_conflict(
                OnConflict::column(Column::Id)
                    .update_columns([
                        Column::OwnerId,
                        Column::Name,
                        Column::Description,
                        Column::ProjectType,
                        Column::PayloadJson,
                        Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec(database)
            .await?;

        Ok(project)
    }

    pub async fn get(
        database: &DatabaseConnection,
        id: &str,
        owner_id: &str,
    ) -> DbResult<Option<Value>> {
        let row = Entity::find()
            .filter(Column::Id.eq(id))
            .filter(Column::OwnerId.eq(owner_id))
            .one(database)
            .await?;

        row.map(model_to_value).transpose()
    }

    pub async fn list(
        database: &DatabaseConnection,
        query: ProjectListQuery,
    ) -> DbResult<ProjectListResult> {
        let page = query.page.max(1);
        let limit = query.limit.clamp(1, 100);
        let search = query.search.unwrap_or_default().to_lowercase();
        let project_type = query.project_type.unwrap_or_default();

        let mut condition = Condition::all().add(Column::OwnerId.eq(query.owner_id));
        if !project_type.is_empty() {
            condition = condition.add(Column::ProjectType.eq(project_type));
        }
        if !search.is_empty() {
            let pattern = format!("%{search}%");
            condition = condition.add(
                Condition::any()
                    .add(Expr::cust_with_values(
                        "lower(name) LIKE ?",
                        [pattern.clone()],
                    ))
                    .add(Expr::cust_with_values(
                        "lower(COALESCE(description, '')) LIKE ?",
                        [pattern],
                    )),
            );
        }

        let base_query = Entity::find().filter(condition);
        let total = base_query.clone().count(database).await? as i64;

        let order_column = if query.sort_by.as_deref() == Some("createdAt") {
            Column::CreatedAt
        } else {
            Column::UpdatedAt
        };

        let rows = base_query
            .order_by_desc(order_column)
            .limit(limit as u64)
            .offset(((page - 1) * limit) as u64)
            .all(database)
            .await?;

        let data = rows
            .into_iter()
            .map(model_to_value)
            .collect::<DbResult<Vec<Value>>>()?;

        Ok(ProjectListResult { data, total })
    }

    pub async fn delete(database: &DatabaseConnection, id: &str, owner_id: &str) -> DbResult<()> {
        Entity::delete_many()
            .filter(Column::Id.eq(id))
            .filter(Column::OwnerId.eq(owner_id))
            .exec(database)
            .await?;
        Ok(())
    }
}

fn model_to_value(model: Model) -> DbResult<Value> {
    Ok(model.payload_json.into())
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}
