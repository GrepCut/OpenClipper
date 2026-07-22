import {
  getClipperDetectorVersion,
  hydrateFaceSampleCache,
  prefillFaceSampleCache,
  serializeFaceSampleCache,
} from "../../engine/reframe";
import { clipperLog, clipperMeasureSync, clipperTimer, clipperWarn } from "../../shared/logger.util";
import { FaceActionBenchmark } from "../../shared/face-action-benchmark.util";
import { getNativeFilePath } from "../../platform/native-source.util";
import {
  clipperFaceDataRelativePath,
  readClipperFaceDetections,
  writeClipperFaceActionBenchmark,
  writeClipperFaceDetections,
} from "../../persistence/project-data-files.util";
import {
  clipperPipelineService,
  markClipperStepCompleted,
} from "../../persistence/pipeline-api.util";
import type { PipelineReporter } from "../reporter.util";
import type { ClipperSession } from "../session.util";
import { isRestoredClipAnalysisValid } from "../is-restored-analysis-valid.util";

export interface AnalyzeFacesStageInput {
  projectId: string;
  mediaFileId: string;
  snappedStart: number;
  end: number;
  skipFaceDetect: boolean;
  skipSubjectAnalysis: boolean;
  runId: string;
}

/** Runs or restores whole-clip face pre-analysis and persists results. */
export async function runAnalyzeFacesStage(
  session: ClipperSession,
  input: AnalyzeFacesStageInput,
  reporter: PipelineReporter,
  options: { signal: AbortSignal },
): Promise<{ faceDetectSkipped: boolean }> {
  const { projectId, mediaFileId, snappedStart, end, skipFaceDetect, skipSubjectAnalysis, runId } = input;
  let faceDetectSkipped = false;

  if (skipFaceDetect) {
    reporter.stage("analyzing-faces", "Restoring face analysis from disk…");
    reporter.faceProgress(0);
    reporter.stageProgress(null);

    const endReadFace = clipperTimer(`pipeline[${runId}]: resume face-read`);
    const blob = await readClipperFaceDetections(projectId, runId);
    endReadFace();
    const detectorVersion = getClipperDetectorVersion();
    const blobValid = blob?.engine !== "wasm" && isRestoredClipAnalysisValid(blob, {
      start: snappedStart,
      end,
      version: detectorVersion,
      blobVersion: blob?.detectorVersion,
    });

    if (blobValid && blob) {
      clipperMeasureSync(
        `pipeline[${runId}]: resume face-hydrate`,
        () => hydrateFaceSampleCache(session.faceCache!, blob),
        () => ({ sampleCount: blob.samples.length }),
      );
      faceDetectSkipped = true;
      clipperLog(`pipeline[${runId}]: restored face cache`, {
        sampleCount: blob.samples.length,
      });
    } else {
      clipperWarn(`pipeline[${runId}]: face blob missing or stale — re-running detect`);
    }
  }

  session.pendingSubjectExtraction = null;

  if (!faceDetectSkipped || !skipSubjectAnalysis) {
    reporter.stage(
      "analyzing-faces",
      faceDetectSkipped ? "Analyzing motion and important subjects…" : "Detecting faces…",
    );
    if (!faceDetectSkipped) {
      reporter.faceProgress(0);
      reporter.stageProgress(null);
    }

    if (!session.faceActionBenchmark) {
      session.faceActionBenchmark = new FaceActionBenchmark();
      session.faceActionBenchmark.setMeta("runId", runId);
      session.faceActionBenchmark.setMeta("projectId", projectId);
      session.faceActionBenchmark.setMeta("clipStartSec", snappedStart);
      session.faceActionBenchmark.setMeta("clipEndSec", end);
      session.faceActionBenchmark.setMeta("faceDetectSkipped", faceDetectSkipped);
      session.faceActionBenchmark.setMeta("skipSubjectAnalysis", skipSubjectAnalysis);
    }
    const benchmark = session.faceActionBenchmark;
    benchmark.enterPhase(faceDetectSkipped ? "subject-extraction-only" : "face-subject-analysis");

    const endFaceAnalysis = clipperTimer(`pipeline[${runId}]: face+subject analysis`);
    const nativePath = getNativeFilePath(session.trimmedFile ?? session.sourceFile);
    if (!nativePath) {
      throw new Error("Smart crop requires a native trimmed video path.");
    }

    const summary = await prefillFaceSampleCache(session.trimmedFile!, session.faceCache!, {
      signal: options.signal,
      nativeSource: { filePath: nativePath, startTime: snappedStart, endTime: end },
      ingestFaces: !faceDetectSkipped,
      onPhase: (message) => reporter.stage("analyzing-faces", message),
      onNativePhase: (phase) => benchmark.enterPhase(phase),
      onProgress: (ratio) => {
        if (!faceDetectSkipped) reporter.faceProgress(ratio);
      },
      onEta: (etaSeconds) => reporter.eta(etaSeconds),
    });
    endFaceAnalysis();

    benchmark.setMeta("engine", "winml");
    benchmark.setMeta("faceDevice", summary.faceDevice);
    benchmark.setMeta("objectDevice", summary.objectDevice);
    benchmark.setMeta("poseDevice", summary.poseDevice);
    benchmark.setMeta("faceSampleCount", summary.faceSampleCount);
    benchmark.setMeta("subjectSampleCount", summary.subjectSampleCount);
    benchmark.setNativeMetrics(summary.metrics as unknown as Record<string, unknown>);
    benchmark.enterPhase("post-face");

    if (options.signal.aborted) {
      throw new DOMException("Conversion aborted", "AbortError");
    }

    if (!skipSubjectAnalysis) {
      session.pendingSubjectExtraction = {
        detections: summary.subjectSamples,
        trackerVersion: summary.trackerVersion,
        sceneCutTimestamps: summary.sceneCutTimestamps,
        sourceFrameRate: summary.sourceFrameRate,
        hasSolidColorBackground: summary.hasSolidColorBackground,
        solidBackgroundColor: summary.solidBackgroundColor,
        staticFeatureSamples: summary.staticFeatureSamples,
        contentRect: summary.contentRect,
      };
    }
  }

  const endPostFace = clipperTimer(`pipeline[${runId}]: post-face total`);
  const benchmark = session.faceActionBenchmark;

  if (!faceDetectSkipped) {
    benchmark?.enterPhase("post-face-serialize");
    const faceBlob = clipperMeasureSync(
      `pipeline[${runId}]: post-face — serialize`,
      () => serializeFaceSampleCache(session.faceCache!, snappedStart, end),
      (blob) => ({ sampleCount: blob.samples.length }),
    );
    benchmark?.enterPhase("post-face-write");
    const localDataPath = clipperFaceDataRelativePath(projectId);
    const endWriteFace = clipperTimer(`pipeline[${runId}]: post-face — write face blob`);
    await writeClipperFaceDetections(projectId, faceBlob);
    endWriteFace();

    benchmark?.enterPhase("post-face-api");
    const endApi = clipperTimer(`pipeline[${runId}]: post-face — api + metadata`);
    await clipperPipelineService.upsertFaceAnalysis(projectId, {
      mediaFileId,
      clipStart: snappedStart,
      clipEnd: end,
      detectorVersion: faceBlob.detectorVersion,
      sampleCount: faceBlob.samples.length,
      localDataPath,
      status: "completed",
    });
    await markClipperStepCompleted(projectId, "analyze_faces", {
      sampleCount: faceBlob.samples.length,
      detectorVersion: faceBlob.detectorVersion,
    });
    endApi();
  } else {
    const endApi = clipperTimer(`pipeline[${runId}]: post-face — api + metadata`);
    endApi();
  }

  endPostFace();
  if (input.skipSubjectAnalysis && session.faceActionBenchmark) {
    await writeClipperFaceActionBenchmark(projectId, session.faceActionBenchmark.toTxt());
    session.faceActionBenchmark = null;
  }
  return { faceDetectSkipped };
}
