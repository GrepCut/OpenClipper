use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};

use super::{impl_migration, Migration};

pub struct M003TestBenchmarks;

impl_migration!(M003TestBenchmarks, 3, up);

async fn up(db: &DatabaseConnection) -> Result<(), DbErr> {
    let statements = [
        "CREATE INDEX IF NOT EXISTS idx_test_clips_dataset_updated ON test_clips(dataset_id, updated_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_test_keyframes_clip_time ON test_keyframes(clip_id, timestamp_us)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_test_targets_keyframe_slot ON test_targets(keyframe_id, slot)",
        "CREATE INDEX IF NOT EXISTS idx_benchmark_runs_dataset_created ON benchmark_runs(dataset_id, created_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_results_run_clip_aspect ON benchmark_results(run_id, clip_id, aspect_id)",
    ];
    for statement in statements {
        db.execute_unprepared(statement).await?;
    }
    Ok(())
}
