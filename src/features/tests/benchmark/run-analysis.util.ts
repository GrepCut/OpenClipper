import { pathBackedFile } from "../../clipper/platform/native-source.util";
import {
  FACE_SAMPLE_INTERVAL_SEC,
  FaceSampleCache,
  prefillFaceSampleCache,
} from "../../clipper/engine/reframe";
import type { VisionAblationConfig } from "../../clipper/engine/reframe";
import { buildAutoFlipTrack } from "../../clipper/engine/autoflip/build-track.util";
import { buildCanonicalPersonTracks } from "../../clipper/engine/autoflip/identity/canonical-person.util";
import { DEFAULT_ARBITER_PARAMS } from "../../clipper/engine/autoflip/layout";
import { resolveClipCohorts } from "./cohort-tags.util";
import { DEFAULT_VISIBILITY_PARAMS } from "../../clipper/engine/autoflip/layout";
import { resolveClipperFrameGeometry } from "../../clipper/engine/render/frame-geometry.util";
import {
  canonicalFormatDims,
  getClipperFormatDef,
} from "../../clipper/shared/formats.util";
import type { TestClip } from "../test.types";
import { TEST_ASPECTS } from "../test.types";
import type { FrameMeta } from "./metadata-drift.types";
import { REPLAY_METRIC_TOLERANCE } from "./replay/replay-tolerance.util";

export interface TestBenchmarkProgress {
  phase: string;
  ratio: number;
}

export interface TestBenchmarkAspectOutput {
  aspectId: string;
  frames: FrameMeta[];
}

export interface TestBenchmarkAnalysisOutput {
  aspects: TestBenchmarkAspectOutput[];
  engine: "winml";
  modelVersion: string;
  trackerVersion: string | null;
  sourceFrameRate: number;
  processingMs: number;
  degradedReason: string | null;
  autoflipDebug: unknown;
  nativeMetrics: Record<string, unknown> | null;
}

function nominalFrameTimestamps(duration: number, frameRate: number): number[] {
  const rate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const count = Math.max(1, Math.ceil(duration * rate));
  return Array.from({ length: count }, (_, index) =>
    Math.min(duration, index / rate),
  );
}

export async function runTestBenchmarkAnalysis(input: {
  clip: TestClip;
  clipPath: string;
  signal: AbortSignal;
  visionAblation?: VisionAblationConfig;
  onProgress?: (progress: TestBenchmarkProgress) => void;
}): Promise<TestBenchmarkAnalysisOutput> {
  const started = performance.now();
  const file = pathBackedFile(input.clipPath, "test-clip.mp4");
  const cache = new FaceSampleCache(FACE_SAMPLE_INTERVAL_SEC, () => {});
  input.onProgress?.({
    phase: "Detecting faces and tracking action",
    ratio: 0,
  });

  const summary = await prefillFaceSampleCache(file, cache, {
    signal: input.signal,
    nativeSource: {
      filePath: input.clipPath,
      startTime: 0,
      endTime: input.clip.duration,
    },
    visionAblation: input.visionAblation,
    onPhase: (phase) => input.onProgress?.({ phase, ratio: 0 }),
    onProgress: (ratio) =>
      input.onProgress?.({
        phase: "Detecting faces and tracking action",
        ratio: ratio * 0.9,
      }),
  });
  if (input.signal.aborted)
    throw new DOMException("Benchmark cancelled", "AbortError");

  const detections = summary.subjectSamples;
  const engine = "winml" as const;
  const trackerVersion = summary.trackerVersion ?? null;
  const degradedReason =
    detections.find((sample) => sample.degradedReason)?.degradedReason ?? null;

  const faceSamples = cache.sortedSamples();
  const aspectRatios = Object.fromEntries(
    TEST_ASPECTS.map((aspect) => [aspect.formatId, aspect.ratio]),
  );
  input.onProgress?.({ phase: "Building production crop tracks", ratio: 0.92 });
  const blob = buildAutoFlipTrack({
    clipStart: 0,
    clipEnd: input.clip.duration,
    detections,
    faces: faceSamples,
    sceneCuts: summary.sceneCutTimestamps,
    hasSolidColorBackground: summary.hasSolidColorBackground,
    solidBackgroundColor: summary.solidBackgroundColor ?? undefined,
    staticFeatureSamples: summary.staticFeatureSamples,
    contentRect: summary.contentRect,
    targetAspectRatios: aspectRatios,
    sourceFrameRate: summary.sourceFrameRate,
    trackerVersion: summary.trackerVersion,
    frameWidth: input.clip.width,
    frameHeight: input.clip.height,
    degradedReason: degradedReason ?? undefined,
    collectDebug: true,
    enhancedIdentityFusion: true,
  });
  blob.engine = engine;

  const timestamps = summary.frameTimestamps.length
    ? summary.frameTimestamps
    : nominalFrameTimestamps(input.clip.duration, summary.sourceFrameRate);
  const source = { width: input.clip.width, height: input.clip.height };
  const aspects = TEST_ASPECTS.map<TestBenchmarkAspectOutput>(
    (aspect, aspectIndex) => {
      const format = getClipperFormatDef(aspect.formatId)!;
      const outputDims = canonicalFormatDims(format);
      const frames = timestamps.map((timestamp) => {
        const geometry = resolveClipperFrameGeometry(
          format,
          source,
          outputDims,
          timestamp,
          {
            smartCropAnalysis: blob,
            disabledCollageRegionIds: [],
          },
        );
        return {
          timestampUs: Math.round(timestamp * 1_000_000),
          layoutMode: geometry.mode,
          panels: geometry.panels.map((panel) => ({
            source: {
              x: panel.source.sx / source.width,
              y: panel.source.sy / source.height,
              width: panel.source.sw / source.width,
              height: panel.source.sh / source.height,
            },
            destination: {
              x: panel.destination.x / outputDims.width,
              y: panel.destination.y / outputDims.height,
              width: panel.destination.width / outputDims.width,
              height: panel.destination.height / outputDims.height,
            },
          })),
        } satisfies FrameMeta;
      });
      input.onProgress?.({
        phase: `Recording ${aspect.label} metadata`,
        ratio: 0.94 + ((aspectIndex + 1) / TEST_ASPECTS.length) * 0.06,
      });
      return { aspectId: aspect.id, frames };
    },
  );
  const processingMs = performance.now() - started;
  const canonicalSamples = buildCanonicalPersonTracks(detections).samples;
  return {
    aspects,
    engine,
    modelVersion: cache.analysisModelVersion,
    trackerVersion,
    sourceFrameRate: summary.sourceFrameRate,
    processingMs,
    degradedReason,
    autoflipDebug: {
      schemaVersion: 6,
      replayConfig: {
        productionPolicy: "iteration10",
        replayMetricTolerance: REPLAY_METRIC_TOLERANCE,
        arbiterParams: { ...DEFAULT_ARBITER_PARAMS },
        visibilityControllerParams: { ...DEFAULT_VISIBILITY_PARAMS },
      },
      semanticFramingParams: null,
      scenes: blob.debug ?? [],
      importanceSamples: blob.importanceSamples ?? [],
      layoutTracks: blob.layoutTracks ?? {},
      subjectSamples: canonicalSamples,
      canonicalIdentityTelemetry: blob.canonicalIdentityTelemetry,
      activeSpeakerTelemetry: blob.activeSpeakerTelemetry,
      cohortTags: resolveClipCohorts(input.clip),
    },
    nativeMetrics: summary.metrics as unknown as Record<string, unknown>,
  };
}
