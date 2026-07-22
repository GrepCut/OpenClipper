import type { BenchmarkResult, TestClip } from "../test.types";
import type { BenchmarkColumnStats, ColumnStatSummary } from "./column-stats.util";
import { computeBenchmarkColumnStats, summarizeValues } from "./column-stats.util";
import { resolveClipCohorts, type BenchmarkCohort } from "./cohort-tags.util";

export interface CohortStatBucket extends BenchmarkColumnStats {
  cohort: BenchmarkCohort;
  clipCount: number;
}

export function computeCohortStats(
  results: BenchmarkResult[],
  clips: TestClip[],
): CohortStatBucket[] {
  const clipMap = new Map(clips.map((clip) => [clip.id, clip]));
  const byCohort = new Map<BenchmarkCohort, BenchmarkResult[]>();
  for (const result of results) {
    const clip = clipMap.get(result.clipId);
    if (!clip) continue;
    for (const cohort of resolveClipCohorts(clip)) {
      const bucket = byCohort.get(cohort) ?? [];
      bucket.push(result);
      byCohort.set(cohort, bucket);
    }
  }
  return [...byCohort.entries()]
    .map(([cohort, cohortResults]) => ({
      cohort,
      clipCount: new Set(cohortResults.map((result) => result.clipId)).size,
      ...computeBenchmarkColumnStats(cohortResults),
    }))
    .sort((left, right) => left.cohort.localeCompare(right.cohort));
}

// Re-export for cohort-stats tests
export { summarizeValues };
export type { ColumnStatSummary };
