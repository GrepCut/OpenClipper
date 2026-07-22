import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActiveSpeakerTelemetry,
  CanonicalIdentityTelemetry,
  ClipperLayoutTrack,
  ImportanceRegionSample,
  SubjectDetectionSample,
} from "../../../clipper/shared/smart-crop";
import {
  DEFAULT_ARBITER_PARAMS,
  RUN10_ARBITER_PARAMS,
  type ArbiterParams,
} from "../../../clipper/engine/autoflip/layout";
import type { SemanticFramingParams } from "../../../clipper/engine/autoflip/layout";
import type { VisibilityControllerParams } from "../../../clipper/engine/autoflip/layout";
import type { BenchmarkMetrics, TestKeyframe } from "../../types";
import { TEST_ASPECTS } from "../../types";
import type { BenchmarkFrameDetail } from "../metrics";

/** Shape of the per-clip autoflip-debug.json artifact. */
export interface RecordedAutoflipDebug {
  schemaVersion?: number;
  replayConfig?: {
    productionPolicy: string;
    arbiterParams: ArbiterParams;
    visibilityControllerParams?: VisibilityControllerParams;
  };
  semanticFramingParams?: SemanticFramingParams | null;
  scenes: Array<{
    formatId: string;
    start: number;
    end: number;
    motionType: string;
  }>;
  importanceSamples: ImportanceRegionSample[];
  layoutTracks: Record<string, ClipperLayoutTrack>;
  /** Benchmark-only raw evidence; never consumed by the production arbiter. */
  subjectSamples?: SubjectDetectionSample[];
  canonicalIdentityTelemetry?: CanonicalIdentityTelemetry;
  activeSpeakerTelemetry?: ActiveSpeakerTelemetry;
  candidates?: {
    iteration10?: {
      importanceSamples: ImportanceRegionSample[];
      layoutTracks: Record<string, ClipperLayoutTrack>;
    };
  };
}

/** Schema-v3 run 2 predates replayConfig but was recorded with Iteration 10. */
export function recordedArbiterParams(
  debug: RecordedAutoflipDebug,
): ArbiterParams {
  if (debug.replayConfig?.arbiterParams)
    return { ...debug.replayConfig.arbiterParams };
  if ((debug.schemaVersion ?? 0) >= 3 && debug.candidates?.iteration10)
    return { ...RUN10_ARBITER_PARAMS };
  return { ...DEFAULT_ARBITER_PARAMS };
}

export interface RecordedStrategyComparison {
  selected: BenchmarkMetrics;
  baseline: BenchmarkMetrics;
  semanticCandidate: BenchmarkMetrics;
}

export interface RunManifest {
  runId: string;
  datasetId: string;
  config: {
    annotationSnapshots: Record<
      string,
      {
        clipSha256: string;
        annotationRevision: number;
        keyframes: TestKeyframe[];
      }
    >;
    aspects: Array<{ id: string; formatId: string; ratio: number }>;
  };
  clips: Array<{ clipId: string; error?: string }>;
  columnStats: {
    portrait9x16: {
      coverage: { avg: number | null };
      coverageHit: { avg: number | null };
      dualAllCovered: { avg: number | null };
      sampleCount: number;
    };
  };
}

export interface ClipDims {
  width: number;
  height: number;
  annotationRevision: number;
  name: string;
}

export interface ClipArtifacts {
  clipId: string;
  aspectId: string;
  formatId: string;
  debug: RecordedAutoflipDebug;
  baselineRows: BenchmarkFrameDetail[];
  /** The production-selected rows persisted as <aspect>.jsonl. */
  selectedRows: BenchmarkFrameDetail[];
  /** Recorded detector-only candidate geometry. Ground-truth fields are never router inputs. */
  detectorCandidateRows?: BenchmarkFrameDetail[];
  comparison: RecordedStrategyComparison;
  keyframes: TestKeyframe[];
  dims: ClipDims;
}

export function appDataDir(): string {
  const appData = process.env.APPDATA;
  if (!appData)
    throw new Error("APPDATA is not set; cannot locate com.openclipper.app.");
  return join(appData, "com.openclipper.app");
}

export function resolveRunDir(datasetId: string, runId: string): string {
  return join(appDataDir(), "test-datasets", datasetId, "runs", runId);
}

export function loadRunManifest(runDir: string): RunManifest {
  return JSON.parse(
    readFileSync(join(runDir, "manifest.json"), "utf8"),
  ) as RunManifest;
}

export function formatIdForAspect(aspectId: string): string {
  const aspect = TEST_ASPECTS.find((entry) => entry.id === aspectId);
  if (!aspect) throw new Error(`Unknown aspect id: ${aspectId}`);
  return aspect.formatId;
}

/**
 * Clip dimensions come from the app database (read-only). Fails hard when the
 * live annotation revision no longer matches the run's snapshot: replaying
 * against drifted ground truth would calibrate the arbiter on stale targets.
 */
export function loadClipDims(
  datasetId: string,
  manifest: RunManifest,
): Map<string, ClipDims> {
  const db = new DatabaseSync(join(appDataDir(), "clipper.sqlite3"), {
    readOnly: true,
  });
  try {
    const rows = db
      .prepare(
        "SELECT id, name, width, height, annotation_revision FROM test_clips WHERE dataset_id = ?",
      )
      .all(datasetId) as Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      annotation_revision: number;
    }>;
    const dims = new Map<string, ClipDims>();
    for (const row of rows) {
      dims.set(row.id, {
        width: row.width,
        height: row.height,
        annotationRevision: row.annotation_revision,
        name: row.name,
      });
    }
    for (const [clipId, snapshot] of Object.entries(
      manifest.config.annotationSnapshots,
    )) {
      const clip = dims.get(clipId);
      if (!clip)
        throw new Error(
          `Clip ${clipId} from the run manifest is missing from the database.`,
        );
      if (clip.annotationRevision !== snapshot.annotationRevision) {
        throw new Error(
          `Annotation revision drift for clip ${clipId} (${clip.name}): ` +
            `run snapshot ${snapshot.annotationRevision}, database ${clip.annotationRevision}. ` +
            "Re-run the benchmark before calibrating against this run.",
        );
      }
    }
    return dims;
  } finally {
    db.close();
  }
}

function readJsonl(path: string): BenchmarkFrameDetail[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BenchmarkFrameDetail);
}

export function loadClipArtifacts(
  runDir: string,
  manifest: RunManifest,
  dims: Map<string, ClipDims>,
  clipId: string,
  aspectId: string,
): ClipArtifacts {
  const clipDir = join(runDir, "clips", clipId);
  const debug = JSON.parse(
    readFileSync(join(clipDir, "autoflip-debug.json"), "utf8"),
  ) as RecordedAutoflipDebug;
  const baselineRows = readJsonl(join(clipDir, `${aspectId}-baseline.jsonl`));
  const selectedRows = readJsonl(join(clipDir, `${aspectId}.jsonl`));
  const detectorCandidatePath = join(
    clipDir,
    `${aspectId}-detector-candidate.jsonl`,
  );
  const comparison = JSON.parse(
    readFileSync(join(clipDir, `${aspectId}-strategy-comparison.json`), "utf8"),
  ) as RecordedStrategyComparison;
  const snapshot = manifest.config.annotationSnapshots[clipId];
  if (!snapshot)
    throw new Error(
      `No annotation snapshot for clip ${clipId} in the run manifest.`,
    );
  const clipDims = dims.get(clipId);
  if (!clipDims) throw new Error(`No dimensions for clip ${clipId}.`);
  return {
    clipId,
    aspectId,
    formatId: formatIdForAspect(aspectId),
    debug,
    baselineRows,
    selectedRows,
    detectorCandidateRows: existsSync(detectorCandidatePath)
      ? readJsonl(detectorCandidatePath)
      : undefined,
    comparison,
    keyframes: snapshot.keyframes,
    dims: clipDims,
  };
}

/** Loads every successfully completed clip of the run for one aspect. */
export function loadRun(
  datasetId: string,
  runId: string,
  aspectId: string,
): {
  manifest: RunManifest;
  clips: ClipArtifacts[];
} {
  const runDir = resolveRunDir(datasetId, runId);
  const manifest = loadRunManifest(runDir);
  const dims = loadClipDims(datasetId, manifest);
  const clips = manifest.clips
    .filter((clip) => !clip.error)
    .map((clip) =>
      loadClipArtifacts(runDir, manifest, dims, clip.clipId, aspectId),
    );
  return { manifest, clips };
}
