import { pathBackedFile } from "../../clipper/platform/native-source.util";
import {
  FACE_SAMPLE_INTERVAL_SEC,
  FaceSampleCache,
  prefillFaceSampleCache,
  cropRectForCentroid,
} from "../../clipper/engine/reframe";
import { buildAutoFlipTrack } from "../../clipper/engine/autoflip/build-track.util";
import { buildCanonicalPersonTracks } from "../../clipper/engine/autoflip/identity/canonical-person.util";
import { DEFAULT_ARBITER_PARAMS } from "../../clipper/engine/autoflip/layout";
import { resolveClipCohorts } from "./cohort-tags.util";
import { DEFAULT_VISIBILITY_PARAMS } from "../../clipper/engine/autoflip/layout";
import {
  augmentFaceSamplesWithDetectedHeads,
  buildCollageTracksForRegions,
  deriveCollageAspectEligibility,
  deriveTwoSpeakerRegions,
  findActiveRegion,
  isCollageAspectEligible,
  resolvePodcastCollageLayout,
} from "../../clipper/engine/reframe/collage";
import { resolveAutoFlipCropRect, resolveClipperLayoutRender } from "../../clipper/engine/render/index";
import { canonicalFormatDims, getClipperFormatDef } from "../../clipper/shared/formats.util";
import { DEFAULT_CLIPPER_SETTINGS } from "../../clipper/settings/settings.util";
import type { TestClip, TestKeyframe } from "../test.types";
import { TEST_ASPECTS } from "../test.types";
import { calculateBenchmarkMetrics, type NormalizedViewport } from "./metrics.util";
import { calculateLayoutOracle } from "./oracle.util";
import { REPLAY_METRIC_TOLERANCE } from "./replay/replay-tolerance.util";
import { interpolateLayoutSample, resolveLayoutTrack } from "../../clipper/engine/autoflip/layout";

export interface TestBenchmarkProgress {
  phase: string;
  ratio: number;
}

export interface TestBenchmarkAspectOutput {
  aspectId: string;
  metrics: ReturnType<typeof calculateBenchmarkMetrics>["metrics"];
  details: ReturnType<typeof calculateBenchmarkMetrics>["details"];
  baselineMetrics: ReturnType<typeof calculateBenchmarkMetrics>["metrics"];
  baselineDetails: ReturnType<typeof calculateBenchmarkMetrics>["details"];
  semanticCandidateMetrics: ReturnType<typeof calculateBenchmarkMetrics>["metrics"];
  semanticCandidateDetails: ReturnType<typeof calculateBenchmarkMetrics>["details"];
  iteration10CandidateMetrics?: ReturnType<typeof calculateBenchmarkMetrics>["metrics"];
  iteration10CandidateDetails?: ReturnType<typeof calculateBenchmarkMetrics>["details"];
  oracle: ReturnType<typeof calculateLayoutOracle>;
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

function normalizedViewport(
  crop: { sx: number; sy: number; sw: number; sh: number },
  width: number,
  height: number,
): NormalizedViewport {
  return {
    x: crop.sx / width,
    y: crop.sy / height,
    width: crop.sw / width,
    height: crop.sh / height,
  };
}

function nominalFrameTimestamps(duration: number, frameRate: number): number[] {
  const rate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const count = Math.max(1, Math.ceil(duration * rate));
  return Array.from({ length: count }, (_, index) =>
    Math.min(duration, index / rate));
}

export async function runTestBenchmarkAnalysis(input: {
  clip: TestClip;
  clipPath: string;
  keyframes: TestKeyframe[];
  signal: AbortSignal;
  onProgress?: (progress: TestBenchmarkProgress) => void;
}): Promise<TestBenchmarkAnalysisOutput> {
  const started = performance.now();
  const file = pathBackedFile(input.clipPath, "test-clip.mp4");
  const cache = new FaceSampleCache(FACE_SAMPLE_INTERVAL_SEC, () => {});
  input.onProgress?.({ phase: "Detecting faces and tracking action", ratio: 0 });

  const summary = await prefillFaceSampleCache(file, cache, {
    signal: input.signal,
    nativeSource: { filePath: input.clipPath, startTime: 0, endTime: input.clip.duration },
    onPhase: (phase) => input.onProgress?.({ phase, ratio: 0 }),
    onProgress: (ratio) => input.onProgress?.({ phase: "Detecting faces and tracking action", ratio: ratio * 0.9 }),
  });
  if (input.signal.aborted) throw new DOMException("Benchmark cancelled", "AbortError");

  const detections = summary.subjectSamples;
  const engine = "winml" as const;
  const trackerVersion = summary.trackerVersion ?? null;
  const degradedReason = detections.find((sample) => sample.degradedReason)?.degradedReason ?? null;

  const faceSamples = cache.sortedSamples();
  const aspectRatios = Object.fromEntries(TEST_ASPECTS.map((aspect) => [aspect.formatId, aspect.ratio]));
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
    smoothing: DEFAULT_CLIPPER_SETTINGS.reframe.smoothing,
    headroom: DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
    degradedReason: degradedReason ?? undefined,
    collectDebug: true,
    enhancedIdentityFusion: true,
  });
  blob.engine = engine;
  const iteration10CandidateBlob = buildAutoFlipTrack({
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
    smoothing: DEFAULT_CLIPPER_SETTINGS.reframe.smoothing,
    headroom: DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
    degradedReason: degradedReason ?? undefined,
    collectDebug: true,
    enhancedIdentityFusion: true,
  });
  iteration10CandidateBlob.engine = engine;

  const collageFaceSamples = augmentFaceSamplesWithDetectedHeads(faceSamples, detections);
  const regions = deriveTwoSpeakerRegions(collageFaceSamples);
  const tracks = buildCollageTracksForRegions(
    collageFaceSamples,
    DEFAULT_CLIPPER_SETTINGS.reframe.smoothing,
    regions,
    [],
  );
  const eligibility = deriveCollageAspectEligibility(
    collageFaceSamples,
    regions,
    DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
  );
  const timestamps = summary.frameTimestamps.length
    ? summary.frameTimestamps
    : nominalFrameTimestamps(input.clip.duration, summary.sourceFrameRate);
  const source = { width: input.clip.width, height: input.clip.height };
  const aspects = TEST_ASPECTS.map<TestBenchmarkAspectOutput>((aspect, aspectIndex) => {
    const format = getClipperFormatDef(aspect.formatId)!;
    const output = canonicalFormatDims(format);
    const baselineFrame = (timestamp: number) => {
      const activeRegion = findActiveRegion(regions, timestamp);
      const useCollage = activeRegion != null
        && isCollageAspectEligible(eligibility, format.aspectId, activeRegion.id, timestamp);
      let viewports: NormalizedViewport[];
      if (useCollage) {
        const layout = resolvePodcastCollageLayout(
          source,
          output,
          tracks,
          timestamp,
          DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
        );
        viewports = [
          normalizedViewport(layout.topCrop, source.width, source.height),
          normalizedViewport(layout.bottomCrop, source.width, source.height),
        ];
      } else {
        const crop = resolveAutoFlipCropRect(blob, aspect.formatId, source, timestamp)
          ?? cropRectForCentroid(source.width, source.height, 0.5, 0.5, aspect.ratio, "normal");
        viewports = [normalizedViewport(crop, source.width, source.height)];
      }
      return {
        timestampUs: Math.round(timestamp * 1_000_000),
        layoutMode: useCollage ? "split" as const : "single-crop" as const,
        viewports,
      };
    };
    const baselineFrames = timestamps.map(baselineFrame);
    const frames = timestamps.map((timestamp, index) => {
      const plannedLayout = resolveClipperLayoutRender(blob, aspect.formatId, source, timestamp);
      return plannedLayout ? {
        timestampUs: Math.round(timestamp * 1_000_000),
        layoutMode: plannedLayout.mode,
        viewports: plannedLayout.viewports.map((viewport) => normalizedViewport(viewport, source.width, source.height)),
        reasonCodes: plannedLayout.reasonCodes,
        requiredRegionIds: plannedLayout.requiredRegionIds,
        subjectDisplayHeightFractions: plannedLayout.subjectDisplayHeightFractions,
      } : baselineFrames[index]!;
    });
    const layoutTrack = resolveLayoutTrack(blob.layoutTracks, aspect.formatId);
    const semanticFrames = timestamps.map((timestamp, index) => {
      const sample = interpolateLayoutSample(layoutTrack, timestamp);
      if (!sample?.candidateViewports?.length) return baselineFrames[index]!;
      return {
        timestampUs: Math.round(timestamp * 1_000_000),
        layoutMode: sample.candidateMode ?? sample.mode,
        viewports: sample.candidateViewports,
      };
    });
    const evaluated = calculateBenchmarkMetrics({
      keyframes: input.keyframes,
      frames,
      sourceWidth: source.width,
      sourceHeight: source.height,
    });
    const baselineEvaluated = calculateBenchmarkMetrics({
      keyframes: input.keyframes,
      frames: baselineFrames,
      sourceWidth: source.width,
      sourceHeight: source.height,
    });
    const semanticEvaluated = calculateBenchmarkMetrics({
      keyframes: input.keyframes,
      frames: semanticFrames,
      sourceWidth: source.width,
      sourceHeight: source.height,
    });
    const iteration10CandidateEvaluated = calculateBenchmarkMetrics({
      keyframes: input.keyframes,
      frames: timestamps.map((timestamp, index) => {
        const render = resolveClipperLayoutRender(iteration10CandidateBlob, aspect.formatId, source, timestamp);
        return render ? {
          timestampUs: Math.round(timestamp * 1_000_000),
          layoutMode: render.mode,
          viewports: render.viewports.map((viewport) => normalizedViewport(viewport, source.width, source.height)),
          reasonCodes: render.reasonCodes,
          requiredRegionIds: render.requiredRegionIds,
          subjectDisplayHeightFractions: render.subjectDisplayHeightFractions,
        } : baselineFrames[index]!;
      }),
      sourceWidth: source.width,
      sourceHeight: source.height,
    });
    const oracle = calculateLayoutOracle({
      timestampsSec: timestamps,
      keyframes: input.keyframes,
      sourceWidth: source.width,
      sourceHeight: source.height,
      targetAspectRatio: aspect.ratio,
    });
    input.onProgress?.({
      phase: `Evaluating ${aspect.label}`,
      ratio: 0.94 + ((aspectIndex + 1) / TEST_ASPECTS.length) * 0.06,
    });
    return {
      aspectId: aspect.id,
      ...evaluated,
      baselineMetrics: baselineEvaluated.metrics,
      baselineDetails: baselineEvaluated.details,
      semanticCandidateMetrics: semanticEvaluated.metrics,
      semanticCandidateDetails: semanticEvaluated.details,
      iteration10CandidateMetrics: iteration10CandidateEvaluated.metrics,
      iteration10CandidateDetails: iteration10CandidateEvaluated.details,
      oracle,
    };
  });
  const processingMs = performance.now() - started;
  for (const aspect of aspects) {
    aspect.metrics.processingMs = processingMs;
    aspect.metrics.realtimeFactor = input.clip.duration / Math.max(0.001, processingMs / 1000);
    aspect.baselineMetrics.processingMs = processingMs;
    aspect.semanticCandidateMetrics.processingMs = processingMs;
    if (aspect.iteration10CandidateMetrics) aspect.iteration10CandidateMetrics.processingMs = processingMs;
  }
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
      candidates: {
        iteration10: {
          importanceSamples: iteration10CandidateBlob.importanceSamples ?? [],
          layoutTracks: iteration10CandidateBlob.layoutTracks ?? {},
          canonicalIdentityTelemetry: iteration10CandidateBlob.canonicalIdentityTelemetry,
          activeSpeakerTelemetry: iteration10CandidateBlob.activeSpeakerTelemetry,
        },
      },
    },
    nativeMetrics: summary.metrics as unknown as Record<string, unknown>,
  };
}
