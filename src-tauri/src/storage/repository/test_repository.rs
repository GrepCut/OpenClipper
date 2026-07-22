use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::storage::entity::{
    benchmark_result, benchmark_run, test_clip, test_dataset, test_keyframe, test_target,
};
use crate::infra::error::{DbError, DbResult};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestTargetDto {
    pub id: String,
    pub slot: i32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestKeyframeDto {
    pub id: String,
    pub timestamp_us: i64,
    #[serde(default = "default_layout_intent")]
    pub layout_intent: String,
    pub targets: Vec<TestTargetDto>,
}

fn default_layout_intent() -> String {
    "crop".into()
}

fn layout_intent(frame: &TestKeyframeDto) -> &str {
    if frame.layout_intent.is_empty() || frame.layout_intent == "crop" {
        "crop"
    } else {
        frame.layout_intent.as_str()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestDatasetSummary {
    #[serde(flatten)]
    pub dataset: test_dataset::Model,
    pub clip_count: usize,
    pub annotated_clip_count: usize,
    pub total_duration: f64,
    pub latest_run: Option<benchmark_run::Model>,
}

pub struct TestRepository;

impl TestRepository {
    pub async fn list_datasets(db: &DatabaseConnection) -> DbResult<Vec<TestDatasetSummary>> {
        let datasets = test_dataset::Entity::find()
            .order_by_desc(test_dataset::Column::UpdatedAt)
            .all(db)
            .await?;
        if datasets.is_empty() {
            return Ok(Vec::new());
        }

        let dataset_ids: Vec<String> = datasets.iter().map(|dataset| dataset.id.clone()).collect();
        let clips = test_clip::Entity::find()
            .filter(test_clip::Column::DatasetId.is_in(dataset_ids.clone()))
            .all(db)
            .await?;
        let clip_ids: Vec<String> = clips.iter().map(|clip| clip.id.clone()).collect();
        let annotated_clip_ids: HashSet<String> = if clip_ids.is_empty() {
            HashSet::new()
        } else {
            test_keyframe::Entity::find()
                .filter(test_keyframe::Column::ClipId.is_in(clip_ids))
                .all(db)
                .await?
                .into_iter()
                .map(|frame| frame.clip_id)
                .collect()
        };
        let runs = benchmark_run::Entity::find()
            .filter(benchmark_run::Column::DatasetId.is_in(dataset_ids))
            .order_by_desc(benchmark_run::Column::CreatedAt)
            .all(db)
            .await?;
        let mut latest_runs = HashMap::new();
        for run in runs {
            latest_runs.entry(run.dataset_id.clone()).or_insert(run);
        }
        let mut clips_by_dataset: HashMap<String, Vec<&test_clip::Model>> = HashMap::new();
        for clip in &clips {
            clips_by_dataset
                .entry(clip.dataset_id.clone())
                .or_default()
                .push(clip);
        }

        Ok(datasets
            .into_iter()
            .map(|dataset| {
                let dataset_clips = clips_by_dataset
                    .get(&dataset.id)
                    .map(|clips| clips.as_slice())
                    .unwrap_or(&[]);
                TestDatasetSummary {
                    total_duration: dataset_clips.iter().map(|clip| clip.duration).sum(),
                    clip_count: dataset_clips.len(),
                    annotated_clip_count: dataset_clips
                        .iter()
                        .filter(|clip| annotated_clip_ids.contains(&clip.id))
                        .count(),
                    latest_run: latest_runs.remove(&dataset.id),
                    dataset,
                }
            })
            .collect())
    }

    pub async fn create_dataset(
        db: &DatabaseConnection,
        id: String,
        name: String,
        description: Option<String>,
    ) -> DbResult<test_dataset::Model> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::message("Dataset name is required."));
        }
        let now = Utc::now().to_rfc3339();
        let model = test_dataset::ActiveModel {
            id: Set(id),
            name: Set(name.to_owned()),
            description: Set(description.filter(|value| !value.trim().is_empty())),
            dataset_role: Set("tuning".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };
        Ok(model.insert(db).await?)
    }

    pub async fn update_dataset(
        db: &DatabaseConnection,
        id: String,
        name: String,
        description: Option<String>,
    ) -> DbResult<test_dataset::Model> {
        let existing = test_dataset::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::message("Test dataset was not found."))?;
        let mut active: test_dataset::ActiveModel = existing.into();
        active.name = Set(name.trim().to_owned());
        active.description = Set(description.filter(|value| !value.trim().is_empty()));
        active.updated_at = Set(Utc::now().to_rfc3339());
        Ok(active.update(db).await?)
    }

    pub async fn update_dataset_role(
        db: &DatabaseConnection,
        id: String,
        dataset_role: String,
    ) -> DbResult<test_dataset::Model> {
        let role = if dataset_role == "holdout" { "holdout" } else { "tuning" };
        let existing = test_dataset::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::message("Test dataset was not found."))?;
        let mut active: test_dataset::ActiveModel = existing.into();
        active.dataset_role = Set(role.to_owned());
        active.updated_at = Set(Utc::now().to_rfc3339());
        Ok(active.update(db).await?)
    }

    pub async fn update_clip_cohorts(
        db: &DatabaseConnection,
        id: String,
        cohort_tags_json: String,
    ) -> DbResult<test_clip::Model> {
        let existing = test_clip::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::message("Test clip was not found."))?;
        let mut active: test_clip::ActiveModel = existing.into();
        active.cohort_tags_json = Set(cohort_tags_json);
        active.updated_at = Set(Utc::now().to_rfc3339());
        Ok(active.update(db).await?)
    }

    pub async fn get_dataset(
        db: &DatabaseConnection,
        id: &str,
    ) -> DbResult<Option<test_dataset::Model>> {
        Ok(test_dataset::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn list_clips(
        db: &DatabaseConnection,
        dataset_id: &str,
    ) -> DbResult<Vec<test_clip::Model>> {
        Ok(test_clip::Entity::find()
            .filter(test_clip::Column::DatasetId.eq(dataset_id))
            .order_by_desc(test_clip::Column::UpdatedAt)
            .all(db)
            .await?)
    }

    pub async fn get_clip(
        db: &DatabaseConnection,
        id: &str,
    ) -> DbResult<Option<test_clip::Model>> {
        Ok(test_clip::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn insert_clip(
        db: &DatabaseConnection,
        model: test_clip::ActiveModel,
    ) -> DbResult<test_clip::Model> {
        Ok(model.insert(db).await?)
    }

    pub async fn annotations(
        db: &DatabaseConnection,
        clip_id: &str,
    ) -> DbResult<Vec<TestKeyframeDto>> {
        let frames = test_keyframe::Entity::find()
            .filter(test_keyframe::Column::ClipId.eq(clip_id))
            .order_by_asc(test_keyframe::Column::TimestampUs)
            .all(db)
            .await?;
        let mut output = Vec::with_capacity(frames.len());
        for frame in frames {
            let targets = test_target::Entity::find()
                .filter(test_target::Column::KeyframeId.eq(frame.id.clone()))
                .order_by_asc(test_target::Column::Slot)
                .all(db)
                .await?
                .into_iter()
                .map(|target| TestTargetDto {
                    id: target.id,
                    slot: target.slot,
                    x: target.x,
                    y: target.y,
                    width: target.width,
                    height: target.height,
                })
                .collect();
            output.push(TestKeyframeDto {
                id: frame.id,
                timestamp_us: frame.timestamp_us,
                layout_intent: frame.layout_intent,
                targets,
            });
        }
        Ok(output)
    }

    pub async fn replace_annotations(
        db: &DatabaseConnection,
        clip_id: &str,
        keyframes: Vec<TestKeyframeDto>,
    ) -> DbResult<(i32, Vec<TestKeyframeDto>)> {
        let clip = test_clip::Entity::find_by_id(clip_id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::message("Test clip was not found."))?;
        validate_keyframes(&keyframes, clip.width as f64, clip.height as f64)?;
        let transaction = db.begin().await?;
        let existing = test_keyframe::Entity::find()
            .filter(test_keyframe::Column::ClipId.eq(clip_id))
            .all(&transaction)
            .await?;
        let ids: Vec<String> = existing.into_iter().map(|row| row.id).collect();
        if !ids.is_empty() {
            test_target::Entity::delete_many()
                .filter(test_target::Column::KeyframeId.is_in(ids))
                .exec(&transaction)
                .await?;
        }
        test_keyframe::Entity::delete_many()
            .filter(test_keyframe::Column::ClipId.eq(clip_id))
            .exec(&transaction)
            .await?;
        let now = Utc::now().to_rfc3339();
        for frame in &keyframes {
            test_keyframe::ActiveModel {
                id: Set(frame.id.clone()),
                clip_id: Set(clip_id.to_owned()),
                timestamp_us: Set(frame.timestamp_us),
                layout_intent: Set(frame.layout_intent.clone()),
                created_at: Set(now.clone()),
                updated_at: Set(now.clone()),
            }
            .insert(&transaction)
            .await?;
            for target in &frame.targets {
                test_target::ActiveModel {
                    id: Set(target.id.clone()),
                    keyframe_id: Set(frame.id.clone()),
                    slot: Set(target.slot),
                    x: Set(target.x),
                    y: Set(target.y),
                    width: Set(target.width),
                    height: Set(target.height),
                }
                .insert(&transaction)
                .await?;
            }
        }
        let revision = clip.annotation_revision + 1;
        let dataset_id = clip.dataset_id.clone();
        let mut active: test_clip::ActiveModel = clip.into();
        active.annotation_revision = Set(revision);
        active.updated_at = Set(now.clone());
        active.update(&transaction).await?;
        if let Some(dataset) = test_dataset::Entity::find_by_id(dataset_id).one(&transaction).await? {
            let mut active: test_dataset::ActiveModel = dataset.into();
            active.updated_at = Set(now);
            active.update(&transaction).await?;
        }
        transaction.commit().await?;
        Ok((revision, keyframes))
    }

    pub async fn create_run(
        db: &DatabaseConnection,
        id: String,
        dataset_id: String,
        clip_ids: Value,
        config: Value,
    ) -> DbResult<benchmark_run::Model> {
        let now = Utc::now().to_rfc3339();
        Ok(benchmark_run::ActiveModel {
            id: Set(id),
            dataset_id: Set(dataset_id),
            status: Set("running".into()),
            selected_clip_ids_json: Set(clip_ids.into()),
            config_json: Set(config.into()),
            manifest_relative_path: Set(None),
            error: Set(None),
            started_at: Set(Some(now.clone())),
            completed_at: Set(None),
            created_at: Set(now),
        }
        .insert(db)
        .await?)
    }

    pub async fn finish_run(
        db: &DatabaseConnection,
        id: &str,
        status: String,
        error: Option<String>,
        manifest_relative_path: Option<String>,
    ) -> DbResult<benchmark_run::Model> {
        if !["completed", "failed", "cancelled"].contains(&status.as_str()) {
            return Err(DbError::message("Invalid terminal benchmark status."));
        }
        let run = benchmark_run::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::message("Benchmark run was not found."))?;
        if run.status != "running" {
            return Err(DbError::message("Completed benchmark runs are immutable."));
        }
        let mut active: benchmark_run::ActiveModel = run.into();
        active.status = Set(status);
        active.error = Set(error);
        active.manifest_relative_path = Set(manifest_relative_path);
        active.completed_at = Set(Some(Utc::now().to_rfc3339()));
        Ok(active.update(db).await?)
    }

    pub async fn list_runs(
        db: &DatabaseConnection,
        dataset_id: &str,
    ) -> DbResult<Vec<benchmark_run::Model>> {
        Ok(benchmark_run::Entity::find()
            .filter(benchmark_run::Column::DatasetId.eq(dataset_id))
            .order_by_desc(benchmark_run::Column::CreatedAt)
            .all(db)
            .await?)
    }

    pub async fn put_result(
        db: &DatabaseConnection,
        model: benchmark_result::ActiveModel,
    ) -> DbResult<benchmark_result::Model> {
        let run_id = match &model.run_id {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value.clone(),
            sea_orm::ActiveValue::NotSet => return Err(DbError::message("Run id is required.")),
        };
        let run = benchmark_run::Entity::find_by_id(run_id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::message("Benchmark run was not found."))?;
        if run.status != "running" {
            return Err(DbError::message("Completed benchmark runs are immutable."));
        }
        Ok(model.insert(db).await?)
    }

    pub async fn list_results(
        db: &DatabaseConnection,
        run_id: &str,
    ) -> DbResult<Vec<benchmark_result::Model>> {
        Ok(benchmark_result::Entity::find()
            .filter(benchmark_result::Column::RunId.eq(run_id))
            .order_by_asc(benchmark_result::Column::ClipId)
            .order_by_asc(benchmark_result::Column::AspectId)
            .all(db)
            .await?)
    }
}

fn validate_keyframes(keyframes: &[TestKeyframeDto], source_width: f64, source_height: f64) -> DbResult<()> {
    const TARGET_ASPECT: f64 = 9.0 / 16.0;
    const ASPECT_TOLERANCE: f64 = 0.01;
    let mut last = None;
    for frame in keyframes {
        if frame.timestamp_us < 0 || last.is_some_and(|value| frame.timestamp_us <= value) {
            return Err(DbError::message("Keyframes must have unique ascending timestamps."));
        }
        let intent = layout_intent(frame);
        if intent != "crop" && intent != "contain" {
            return Err(DbError::message("Keyframe layout intent must be crop or contain."));
        }
        if intent == "contain" {
            if frame.targets.len() != 1 {
                return Err(DbError::message("Contain keyframes must contain exactly one target."));
            }
        } else if !(1..=2).contains(&frame.targets.len()) {
            return Err(DbError::message("Each crop keyframe must contain one or two targets."));
        }
        for (index, target) in frame.targets.iter().enumerate() {
            if target.slot != index as i32
                || !target.x.is_finite()
                || !target.y.is_finite()
                || !target.width.is_finite()
                || !target.height.is_finite()
                || target.width <= 0.0
                || target.height <= 0.0
                || target.x < 0.0
                || target.y < 0.0
                || target.x + target.width > 1.0 + 1e-9
                || target.y + target.height > 1.0 + 1e-9
            {
                return Err(DbError::message("Invalid normalized target geometry."));
            }
            if intent == "crop" {
                let aspect = (target.width * source_width) / (target.height * source_height).max(1e-9);
                if (aspect - TARGET_ASPECT).abs() > ASPECT_TOLERANCE {
                    return Err(DbError::message("Target crop boxes must be 9:16 in pixel space."));
                }
            }
        }
        last = Some(frame.timestamp_us);
    }
    Ok(())
}
