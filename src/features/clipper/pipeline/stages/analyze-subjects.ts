import {
  AUTOFLIP_ANALYZER_VERSION,
  buildAutoFlipTrack,
  primaryAspectTrackSampleCount,
} from "../../engine/autoflip/build-autoflip-track";
import { augmentFaceSamplesWithDetectedHeads } from "../../engine/collage";
import { CLIPPER_FORMAT_DEFS } from "../../shared/formats";
import { aspectRatioFromId } from "../../lib/media/video-draw";
import type { ClipperHeadroom, ClipperSmoothingStrength } from "../../settings/settings";
import {
  clipperSmartCropDataRelativePath,
  readClipperSmartCropAnalysis,
  writeClipperFaceActionBenchmark,
  writeClipperSmartCropAnalysis,
} from "../../persistence/project-data-files";
import { clipperPipelineService, markClipperStepCompleted } from "../../persistence/pipeline-api";
import type { PipelineReporter } from "../reporter";
import type { ClipperSession } from "../session";
import { isRestoredSmartCropAnalysisValid } from "../is-restored-analysis-valid";

export interface AnalyzeSubjectsInput {
  projectId: string;
  clipStart: number;
  clipEnd: number;
  skipSubjectAnalysis: boolean;
  enabledFormatIds?: string[];
  smoothing?: ClipperSmoothingStrength;
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
  });
}

function frameDimensions(session: ClipperSession): { frameWidth: number; frameHeight: number } {
  const faceSample = session.faceCache?.sortedSamples()[0];
  if (faceSample?.frameW && faceSample?.frameH) {
    return { frameWidth: faceSample.frameW, frameHeight: faceSample.frameH };
  }
  return { frameWidth: 1920, frameHeight: 1080 };
}

function cropAspectRatios(): Record<string, number> {
  return Object.fromEntries(
    CLIPPER_FORMAT_DEFS
      .filter((format) => format.mode === "crop")
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
  const detections = pending?.detections ?? [];
  const degradedReason = pending?.degradedReason
    ?? detections.find((sample) => sample.degradedReason)?.degradedReason;

  if (!pending || detections.length === 0) {
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
  benchmark?.enterPhase("autoflip-track-build");

  const { frameWidth, frameHeight } = frameDimensions(session);
  const blob = buildAutoFlipTrack({
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    detections,
    faces: session.faceCache?.sortedSamples() ?? [],
    sceneCuts: pending.sceneCutTimestamps,
    hasSolidColorBackground: pending.hasSolidColorBackground,
    solidBackgroundColor: pending.solidBackgroundColor ?? undefined,
    staticFeatureSamples: pending.staticFeatureSamples,
    importanceSignals: pending.importanceSignals,
    contentRect: pending.contentRect,
    targetAspectRatios: cropAspectRatios(),
    sourceFrameRate: pending.sourceFrameRate,
    trackerVersion: pending.trackerVersion,
    frameWidth,
    frameHeight,
    smoothing: input.smoothing ?? "balanced",
    headroom: input.headroom,
    degradedReason,
    iteration10: true,
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
