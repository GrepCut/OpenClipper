import { invoke } from "@tauri-apps/api/core";
import { ToolFaceDetectorService } from "../../clipper/lib/media/face-detector";
import { pathBackedFile } from "../../clipper/platform/native-source";
import {
  CLIPPER_FACE_DETECTOR_OPTIONS,
  FACE_SAMPLE_INTERVAL_SEC,
  FaceSampleCache,
  prefillFaceSampleCache,
  cropRectForCentroid,
} from "../../clipper/engine/reframe";
import { SubjectDetectorWorkerClient } from "../../clipper/workers/subject-detect/client";
import type { SubjectDetectionSample } from "../../clipper/shared/smart-crop";
import { buildAutoFlipTrack } from "../../clipper/engine/autoflip/build-autoflip-track";
import { buildCanonicalPersonTracks } from "../../clipper/engine/autoflip/canonical-person";
import { buildDetectorHypothesisBank } from "../../clipper/engine/autoflip/detector-hypotheses";
import { RUN10_ARBITER_PARAMS } from "../../clipper/engine/autoflip/layout-arbiter";
import { DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS } from "../../clipper/engine/autoflip/segment-detector-router";
import { ITERATION10_VISIBILITY_CONTROLLER_PARAMS, ITERATION11_DETECTOR_VISIBILITY_PARAMS } from "../../clipper/engine/autoflip/visibility-controller";
import {
  augmentFaceSamplesWithDetectedHeads,
  buildCollageTracksForRegions,
  deriveCollageAspectEligibility,
  deriveTwoSpeakerRegions,
  findActiveRegion,
  isCollageAspectEligible,
  resolvePodcastCollageLayout,
} from "../../clipper/engine/collage";
import { resolveAutoFlipCropRect, resolveClipperLayoutRender } from "../../clipper/engine/frame-draw";
import { canonicalFormatDims, getClipperFormatDef } from "../../clipper/shared/formats";
import { DEFAULT_CLIPPER_SETTINGS } from "../../clipper/settings/settings";
import type { TestClip, TestKeyframe } from "../types";
import { TEST_ASPECTS } from "../types";
import { calculateBenchmarkMetrics, type NormalizedViewport } from "./metrics";
import { calculateLayoutOracle } from "./oracle";
import { interpolateLayoutSample, resolveLayoutTrack } from "../../clipper/engine/autoflip/layout-planner";

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
  detectorCandidateMetrics?: ReturnType<typeof calculateBenchmarkMetrics>["metrics"];
  detectorCandidateDetails?: ReturnType<typeof calculateBenchmarkMetrics>["details"];
  iteration10CandidateMetrics?: ReturnType<typeof calculateBenchmarkMetrics>["metrics"];
  iteration10CandidateDetails?: ReturnType<typeof calculateBenchmarkMetrics>["details"];
  oracle: ReturnType<typeof calculateLayoutOracle>;
}

export interface TestBenchmarkAnalysisOutput {
  aspects: TestBenchmarkAspectOutput[];
  engine: "winml" | "wasm";
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
  const detectionTasks: Promise<SubjectDetectionSample>[] = [];
  let subjectDetector: SubjectDetectorWorkerClient | null = new SubjectDetectorWorkerClient();
  input.onProgress?.({ phase: "Detecting faces and tracking action", ratio: 0 });

  const summary = await prefillFaceSampleCache(
    file,
    cache,
    ToolFaceDetectorService.getInstance(),
    {
      signal: input.signal,
      nativeSource: { filePath: input.clipPath, startTime: 0, endTime: input.clip.duration },
      onPhase: (phase) => input.onProgress?.({ phase, ratio: 0 }),
      onProgress: (ratio) => input.onProgress?.({ phase: "Detecting faces and tracking action", ratio: ratio * 0.9 }),
      subjectExtraction: {
        targetWidth: 480,
        onSubjectFrame: (frame, timestampSec) => {
          const task = subjectDetector!.detect(frame.frameUrl, timestampSec);
          detectionTasks.push(task);
          void task.catch(() => {});
        },
      },
    },
  );
  if (!summary) throw new Error("Video analysis did not return a result.");
  if (input.signal.aborted) throw new DOMException("Benchmark cancelled", "AbortError");

  let detections: SubjectDetectionSample[];
  let engine: "winml" | "wasm";
  let trackerVersion: string | null = null;
  let degradedReason: string | null = null;
  if (summary.engine === "winml") {
    subjectDetector.dispose();
    subjectDetector = null;
    detections = summary.subjectSamples;
    engine = "winml";
    trackerVersion = summary.trackerVersion ?? null;
  } else {
    const settled = await Promise.allSettled(detectionTasks);
    detections = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    degradedReason = settled.some((result) => result.status === "rejected")
      ? "Some compatible WASM subject samples failed."
      : null;
    subjectDetector.dispose();
    subjectDetector = null;
    if (summary.jobId) await invoke("cleanup_clipper_frames", { jobId: summary.jobId }).catch(() => {});
    engine = "wasm";
  }

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
    trackerVersion: summary.engine === "winml" ? summary.trackerVersion : undefined,
    frameWidth: input.clip.width,
    frameHeight: input.clip.height,
    smoothing: DEFAULT_CLIPPER_SETTINGS.reframe.smoothing,
    headroom: DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
    degradedReason: degradedReason ?? undefined,
    collectDebug: true,
    iteration10: true,
    iteration11: true,
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
    trackerVersion: summary.engine === "winml" ? summary.trackerVersion : undefined,
    frameWidth: input.clip.width,
    frameHeight: input.clip.height,
    smoothing: DEFAULT_CLIPPER_SETTINGS.reframe.smoothing,
    headroom: DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
    degradedReason: degradedReason ?? undefined,
    collectDebug: true,
    iteration10: true,
  });
  iteration10CandidateBlob.engine = engine;
  const hasDetectorShadow = detections.some((sample) => sample.shadowDetections?.length);
  const detectorCandidateBlob = hasDetectorShadow ? buildAutoFlipTrack({
    clipStart: 0,
    clipEnd: input.clip.duration,
    detections: detections.map((sample) => ({
      ...sample,
      detections: sample.shadowDetections?.length ? sample.shadowDetections : sample.detections,
      shadowDetections: undefined,
      modelId: "yolox-tiny-shadow",
    })),
    faces: faceSamples,
    sceneCuts: summary.sceneCutTimestamps,
    hasSolidColorBackground: summary.hasSolidColorBackground,
    solidBackgroundColor: summary.solidBackgroundColor ?? undefined,
    staticFeatureSamples: summary.staticFeatureSamples,
    contentRect: summary.contentRect,
    targetAspectRatios: aspectRatios,
    sourceFrameRate: summary.sourceFrameRate,
    trackerVersion: summary.engine === "winml" ? summary.trackerVersion : undefined,
    frameWidth: input.clip.width,
    frameHeight: input.clip.height,
    smoothing: DEFAULT_CLIPPER_SETTINGS.reframe.smoothing,
    headroom: DEFAULT_CLIPPER_SETTINGS.reframe.headroom,
    degradedReason: degradedReason ?? undefined,
    collectDebug: true,
  }) : null;

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
    const detectorCandidateEvaluated = detectorCandidateBlob ? calculateBenchmarkMetrics({
      keyframes: input.keyframes,
      frames: timestamps.map((timestamp, index) => {
        const render = resolveClipperLayoutRender(detectorCandidateBlob, aspect.formatId, source, timestamp);
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
    }) : null;
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
      detectorCandidateMetrics: detectorCandidateEvaluated?.metrics,
      detectorCandidateDetails: detectorCandidateEvaluated?.details,
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
    if (aspect.detectorCandidateMetrics) aspect.detectorCandidateMetrics.processingMs = processingMs;
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
      schemaVersion: 5,
      replayConfig: {
        productionPolicy: "iteration11",
        arbiterParams: { ...RUN10_ARBITER_PARAMS },
        visibilityControllerParams: { ...ITERATION10_VISIBILITY_CONTROLLER_PARAMS },
        detectorRouterParams: { ...DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS },
        detectorVisibilityParams: { ...ITERATION11_DETECTOR_VISIBILITY_PARAMS },
      },
      semanticFramingParams: null,
      scenes: blob.debug ?? [],
      importanceSamples: blob.importanceSamples ?? [],
      layoutTracks: blob.layoutTracks ?? {},
      routerDecisions: blob.routerDecisions ?? [],
      detectorSpliceTracks: blob.detectorSpliceTracks,
      subjectSamples: canonicalSamples,
      detectorHypothesisSamples: buildDetectorHypothesisBank(canonicalSamples),
      canonicalIdentityTelemetry: blob.canonicalIdentityTelemetry,
      activeSpeakerTelemetry: blob.activeSpeakerTelemetry,
      candidates: {
        ...(detectorCandidateBlob ? { yolox: {
          importanceSamples: detectorCandidateBlob.importanceSamples ?? [],
          layoutTracks: detectorCandidateBlob.layoutTracks ?? {},
        } } : {}),
        iteration10: {
          importanceSamples: iteration10CandidateBlob.importanceSamples ?? [],
          layoutTracks: iteration10CandidateBlob.layoutTracks ?? {},
          canonicalIdentityTelemetry: iteration10CandidateBlob.canonicalIdentityTelemetry,
          activeSpeakerTelemetry: iteration10CandidateBlob.activeSpeakerTelemetry,
        },
      },
    },
    nativeMetrics: summary.engine === "winml"
      ? summary.metrics as unknown as Record<string, unknown>
      : null,
  };
}
