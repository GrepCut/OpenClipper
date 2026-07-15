import { ToolFaceDetectorService } from "../../lib/media/face-detector";
import {
  getClipperDetectorVersion,
  hydrateFaceSampleCache,
  prefillFaceSampleCache,
  serializeFaceSampleCache,
} from "../../engine/reframe";
import { clipperLog, clipperMeasureSync, clipperTimer, clipperWarn } from "../../shared/logger";
import { FaceActionBenchmark } from "../../shared/face-action-benchmark";
import { getNativeFilePath } from "../../platform/native-source";
import {
  clipperFaceDataRelativePath,
  readClipperFaceDetections,
  writeClipperFaceActionBenchmark,
  writeClipperFaceDetections,
} from "../../persistence/project-data-files";
import {
  clipperPipelineService,
  markClipperStepCompleted,
} from "../../persistence/pipeline-api";
import type { SubjectDetectionSample } from "../../shared/smart-crop";
import { SubjectDetectorWorkerClient } from "../../workers/subject-detect/client";
import type { PipelineReporter } from "../reporter";
import type { ClipperSession } from "../session";
import { isRestoredClipAnalysisValid } from "../is-restored-analysis-valid";

export interface AnalyzeFacesStageInput {
  projectId: string;
  mediaFileId: string;
  snappedStart: number;
  end: number;
  skipFaceDetect: boolean;
  /** When false, the same native decode pass also samples subject/motion frames for the subjects stage (see `session.pendingSubjectExtraction`). */
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
    const blobValid = isRestoredClipAnalysisValid(blob, {
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
    // Native extraction reads the 0-based *trimmed range* file — snappedStart/end
    // here are always range-relative (0..rangeDuration), matching what the
    // subjects stage already expected from this same decode pass.
    const nativePath = getNativeFilePath(session.trimmedFile ?? session.sourceFile);
    // Subject/motion extraction is native-only (no browser fallback) — skip
    // spinning up a detector worker when there's no native path to feed it.
    let subjectDetector: SubjectDetectorWorkerClient | null = null;
    const detectionTasks: Promise<SubjectDetectionSample>[] = [];
    if (!skipSubjectAnalysis && nativePath) {
      subjectDetector = new SubjectDetectorWorkerClient();
    }

    const summary = await prefillFaceSampleCache(session.trimmedFile!, session.faceCache!, ToolFaceDetectorService.getInstance(), {
      signal: options.signal,
      nativeSource: nativePath
        ? { filePath: nativePath, startTime: snappedStart, endTime: end }
        : undefined,
      onPhase: (message) => reporter.stage("analyzing-faces", message),
      onNativePhase: (phase) => benchmark.enterPhase(phase),
      onProgress: (ratio) => {
        if (!faceDetectSkipped) reporter.faceProgress(ratio);
      },
      onEta: (etaSeconds) => reporter.eta(etaSeconds),
      subjectExtraction: subjectDetector
        ? {
            targetWidth: 480,
            onSubjectFrame: (frame, timestampSec) => {
              const detectionTask = subjectDetector!.detect(frame.frameUrl, timestampSec);
              detectionTasks.push(detectionTask);
              // Results are collected with Promise.allSettled once native extraction
              // completes. Observe failures now as well, so a failed frame does not
              // trigger the browser's unhandled-rejection warning while extraction
              // is still streaming more frames.
              void detectionTask.catch(() => {});
            },
          }
        : undefined,
    });
    endFaceAnalysis();
    if (summary && "engine" in summary && summary.engine === "winml" && "metrics" in summary) {
      benchmark.setMeta("engine", "winml");
      benchmark.setMeta("faceDevice", summary.faceDevice);
      benchmark.setMeta("objectDevice", summary.objectDevice);
      benchmark.setMeta("faceSampleCount", summary.faceSampleCount);
      benchmark.setMeta("subjectSampleCount", summary.subjectSampleCount);
      benchmark.setNativeMetrics(summary.metrics as unknown as Record<string, unknown>);
    } else if (summary) {
      benchmark.setMeta("engine", summary.engine === "legacy" ? "wasm-hybrid" : "wasm-hybrid");
      benchmark.setMeta("faceFrameCount", summary.face.frameCount);
      benchmark.setMeta("subjectFrameCount", summary.subject?.frameCount ?? 0);
    } else {
      benchmark.setMeta("engine", nativePath ? "wasm-hybrid" : "browser-wasm");
    }
    benchmark.enterPhase("post-face");
    if (options.signal.aborted) {
      subjectDetector?.dispose();
      if (summary && summary.engine !== "winml" && summary.jobId) {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("cleanup_clipper_frames", { jobId: summary.jobId }))
          .catch(() => {});
      }
      throw new DOMException("Conversion aborted", "AbortError");
    }

    if (!skipSubjectAnalysis) {
      if (summary?.engine === "winml") {
        subjectDetector?.dispose();
        session.pendingSubjectExtraction = {
          jobId: "",
          detectionTasks: [],
          detections: summary.subjectSamples,
          engine: "winml",
          trackerVersion: summary.trackerVersion,
          sceneCutTimestamps: summary.sceneCutTimestamps,
          sourceFrameRate: summary.sourceFrameRate,
          hasSolidColorBackground: summary.hasSolidColorBackground,
          solidBackgroundColor: summary.solidBackgroundColor,
          staticFeatureSamples: summary.staticFeatureSamples,
          contentRect: summary.contentRect,
        };
      } else {
        session.pendingSubjectExtraction = summary?.subject
        ? {
            jobId: summary.jobId,
            detectionTasks,
            dispose: () => subjectDetector?.dispose(),
            engine: "wasm",
            sceneCutTimestamps: summary.sceneCutTimestamps,
            sourceFrameRate: summary.sourceFrameRate,
            hasSolidColorBackground: summary.hasSolidColorBackground,
            solidBackgroundColor: summary.solidBackgroundColor,
            staticFeatureSamples: summary.staticFeatureSamples,
            contentRect: summary.contentRect,
          }
        : {
            jobId: "",
            detectionTasks: [],
            sceneCutTimestamps: [],
            degradedReason: nativePath
              ? "Subject extraction failed."
              : "Smart crop requires a native trimmed video path.",
          };
        if (subjectDetector && !summary?.subject) subjectDetector.dispose();
      }
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
