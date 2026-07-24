import { AUTOFLIP_ANALYZER_VERSION } from "../../engine/autoflip/config/config.constants";
import {
  buildAutoFlipTrack,
  primaryAspectTrackSampleCount,
} from "../../engine/autoflip/build-track.util";
import { augmentFaceSamplesWithDetectedHeads } from "../../engine/reframe/collage";
import { CLIPPER_FORMAT_DEFS } from "../../shared/formats.util";
import { aspectRatioFromId } from "../../lib/media/video-draw.util";
import { yieldToMain } from "../../shared/yield-to-main.util";
import type { ClipperHeadroom } from "../../settings/settings.util";
import {
  clipperSmartCropDataRelativePath,
  readClipperSmartCropAnalysis,
  writeClipperFaceActionBenchmark,
  writeClipperSmartCropAnalysis,
} from "../../persistence/project-data-files.util";
import { clipperPipelineService, markClipperStepCompleted } from "../../persistence/pipeline-api.util";
import type { PipelineReporter } from "../reporter.util";
import type { ClipperSession } from "../session.util";
import { isRestoredSmartCropAnalysisValid } from "../is-restored-analysis-valid.util";

export interface AnalyzeSubjectsInput {
  projectId: string;
  clipStart: number;
  clipEnd: number;
  skipSubjectAnalysis: boolean;
  enabledFormatIds?: string[];
  headroom?: ClipperHeadroom;
}

function isValidRestoredBlob(
  blob: Awaited<ReturnType<typeof readClipperSmartCropAnalysis>>,
  start: number,
  end: number,
): boolean {
  if (blob?.engine === "wasm") return false;
  return isRestoredSmartCropAnalysisValid(blob, {
    start,
    end,
    version: AUTOFLIP_ANALYZER_VERSION,
    blobVersion: blob?.analyzerVersion,
    smoothing: "smooth",
  });
}

function frameDimensions(session: ClipperSession): { frameWidth: number; frameHeight: number } {
  const faceSample = session.faceCache?.sortedSamples()[0];
  if (faceSample?.frameW && faceSample?.frameH) {
    return { frameWidth: faceSample.frameW, frameHeight: faceSample.frameH };
  }
  return { frameWidth: 1920, frameHeight: 1080 };
}

function synthesizeDetectionsFromFaceCache(faceSamples: ReturnType<NonNullable<ClipperSession["faceCache"]>["sortedSamples"]>): SubjectDetectionSample[] {
  return faceSamples.map((sample) => {
    const frameW = sample.frameW || 1920;
    const frameH = sample.frameH || 1080;
    const autoflipFaces = sample.faces.map((f) => ({
      box: {
        x: Math.max(0, Math.min(1, f.x / frameW)),
        y: Math.max(0, Math.min(1, f.y / frameH)),
        width: Math.max(0, Math.min(1, f.width / frameW)),
        height: Math.max(0, Math.min(1, f.height / frameH)),
      },
      keypoints: [],
      trackId: f.trackId,
    }));
    const detections = autoflipFaces.map((f) => ({
      box: f.box,
      label: "person",
      score: 0.9,
      trackId: f.trackId,
      detectorSource: "pose" as const,
    }));
    return {
      time: sample.time,
      detections,
      autoflipFaces,
      sceneCut: sample.sceneCut,
    };
  });
}

function cropAspectRatios(enabledFormatIds?: string[]): Record<string, number> {
  const enabled = enabledFormatIds?.length ? new Set(enabledFormatIds) : null;
  return Object.fromEntries(
    CLIPPER_FORMAT_DEFS
      .filter((format) => format.mode === "crop" && (!enabled || enabled.has(format.id)))
      .map((format) => [format.id, aspectRatioFromId(format.aspectId)]),
  );
}

export async function runAnalyzeSubjectsStage(
  session: ClipperSession,
  input: AnalyzeSubjectsInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<void> {
  reporter.stage("analyzing-subjects", "Restoring smart crop analysis…");
  reporter.subjectProgress(0);
  if (input.skipSubjectAnalysis) {
    const restored = await readClipperSmartCropAnalysis(input.projectId);
    if (isValidRestoredBlob(restored, input.clipStart, input.clipEnd)) {
      session.smartCropAnalysis = restored;
      reporter.subjectProgress(1);
      await markClipperStepCompleted(input.projectId, "preview_ready");
      await writeFaceActionBenchmarkIfPresent(session, input.projectId);
      return;
    }
  }

  await clipperPipelineService.upsertSteps(input.projectId, [
    { stepKey: "analyze_subjects", status: "active", progress: 0 },
  ]);
  reporter.stage("analyzing-subjects", "Building AutoFlip reframe track…");

  const benchmark = session.faceActionBenchmark;
  benchmark?.enterPhase("subject-detection-await");

  const pending = session.pendingSubjectExtraction ?? null;
  session.pendingSubjectExtraction = null;
  const faceCacheSamples = session.faceCache?.sortedSamples() ?? [];
  let detections = pending?.detections ?? [];
  if (detections.length === 0 && faceCacheSamples.length > 0) {
    detections = synthesizeDetectionsFromFaceCache(faceCacheSamples);
  }
  const degradedReason = pending?.degradedReason
    ?? detections.find((sample) => sample.degradedReason)?.degradedReason;

  if (detections.length === 0) {
    session.smartCropAnalysis = null;
    await markClipperStepCompleted(input.projectId, "analyze_subjects", {
      analyzerVersion: AUTOFLIP_ANALYZER_VERSION,
      modelId: null,
      sampleCount: 0,
      localDataPath: null,
      degradedReason: degradedReason ?? "WinML subject analysis did not return detections.",
    });
    await markClipperStepCompleted(input.projectId, "preview_ready");
    reporter.subjectProgress(1);
    await writeFaceActionBenchmarkIfPresent(session, input.projectId);
    return;
  }

  reporter.subjectProgress(0.95);
  // Let React paint the transition out of the 92% native-analysis bucket
  // before the synchronous track build starts.
  await yieldToMain();
  if (options.signal.aborted) {
    throw new DOMException("Conversion aborted", "AbortError");
  }
  benchmark?.enterPhase("autoflip-track-build");

  const { frameWidth, frameHeight } = frameDimensions(session);
  const blob = buildAutoFlipTrack({
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    detections,
    faces: session.faceCache?.sortedSamples() ?? [],
    sceneCuts: pending?.sceneCutTimestamps ?? [],
    hasSolidColorBackground: pending?.hasSolidColorBackground,
    solidBackgroundColor: pending?.solidBackgroundColor ?? undefined,
    staticFeatureSamples: pending?.staticFeatureSamples,
    importanceSignals: pending?.importanceSignals,
    contentRect: pending?.contentRect,
    targetAspectRatios: cropAspectRatios(input.enabledFormatIds),
    sourceFrameRate: pending?.sourceFrameRate,
    trackerVersion: pending?.trackerVersion,
    frameWidth,
    frameHeight,
    headroom: input.headroom,
    degradedReason,
    enhancedIdentityFusion: true,
  });
  blob.engine = "winml";
  session.smartCropAnalysis = blob;
  session.collageFaceSamples = augmentFaceSamplesWithDetectedHeads(
    session.faceCache?.sortedSamples() ?? [],
    detections,
  );
  session.faceRenderCache = null;
  benchmark?.enterPhase("smart-crop-persist");
  await writeClipperSmartCropAnalysis(input.projectId, blob);
  await markClipperStepCompleted(input.projectId, "analyze_subjects", {
    analyzerVersion: blob.analyzerVersion,
    modelId: blob.modelId,
    sampleCount: primaryAspectTrackSampleCount(blob),
    localDataPath: clipperSmartCropDataRelativePath(input.projectId),
    degradedReason: degradedReason ?? null,
  });
  await markClipperStepCompleted(input.projectId, "preview_ready");
  reporter.subjectProgress(1);
  await writeFaceActionBenchmarkIfPresent(session, input.projectId);
}

async function writeFaceActionBenchmarkIfPresent(session: ClipperSession, projectId: string): Promise<void> {
  const benchmark = session.faceActionBenchmark;
  if (!benchmark) return;
  benchmark.setMeta("subjectSampleCountFinal", session.smartCropAnalysis ? primaryAspectTrackSampleCount(session.smartCropAnalysis) : 0);
  await writeClipperFaceActionBenchmark(projectId, benchmark.toTxt());
  session.faceActionBenchmark = null;
}
