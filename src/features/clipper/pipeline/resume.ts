import type { ClipperProjectMetadata } from "../persistence/project-metadata";
import type { ClipperResumePlan } from "../persistence/pipeline-api";
import type { WordCue } from "../lib/media/transcription-export";
import type { ClipperPipelineState } from "../shared/state";

export const EMPTY_CLIPPER_PIPELINE_STATE: ClipperPipelineState = {
  stage: "idle",
  stageMessage: "",
  renderProgress: {},
  exportHistory: [],
  rangeTrimmedVideoUrl: null,
  clipPreviews: [],
  autoPartsClipPreviews: [],
  aiClipPreviews: [],
  clipSourceMode: "auto-parts",
  activeClipIndex: 0,
  error: null,
  clipDuration: null,
  sourceFileName: null,
  sourceDuration: null,
  clipStart: 0,
  clipEnd: null,
  hasDetectedFaces: null,
  hasTwoSpeakers: null,
  faceSampleRevision: 0,
  rangeWords: [],
  faceAnalysisProgress: null,
  subjectAnalysisProgress: null,
  analysisEtaSeconds: null,
  stageProgress: null,
};

export interface ResumeLoadedInput {
  metadata: ClipperProjectMetadata;
  sourceFile: File | null;
  sourceUrl: string | null;
  sourceDuration: number | null;
  sourceFileName: string | null;
  mediaFileId: string | null;
  words: WordCue[];
  resumePlan: ClipperResumePlan;
}

export function buildLoadedResumeKey(loaded: ResumeLoadedInput, projectId: string): string {
  const { metadata, resumePlan } = loaded;
  return [
    projectId,
    metadata.stage,
    metadata.clipStart,
    metadata.clipEnd,
    loaded.words.length,
    loaded.mediaFileId,
    resumePlan.target,
    resumePlan.skipTranscribe,
    resumePlan.skipFaceDetect,
    resumePlan.skipSubjectAnalysis,
    resumePlan.skipToPreview,
  ].join("|");
}

export type ResumePlan =
  | { kind: "idle" }
  | {
      kind: "trimming";
      sourceFileName: string | null;
      sourceDuration: number | null;
      clipStart: number;
      clipEnd: number | null;
    }
  | {
      kind: "restore";
      clipEnd: number;
      previewOptions: {
        projectId: string;
        mediaFileId: string;
        skipFaceDetect: boolean;
        skipSubjectAnalysis: boolean;
        skipTrim: boolean;
      };
      /** True when preview was already prepared — restore without re-trimming/transcribing. */
      useFastPreviewRestore: boolean;
      /** True when word cues were loaded (informational; does not gate restore path). */
      useWords: boolean;
      words: WordCue[];
      clipStart: number;
      sourceFileName: string | null;
      sourceDuration: number | null;
    };

/** Interprets loaded project state into a resume execution plan. */
export function planResumeExecution(
  loaded: ResumeLoadedInput,
  metadata: ClipperProjectMetadata,
  resumePlan: ClipperResumePlan,
  projectId: string,
): ResumePlan {
  if (!loaded.sourceFile || !loaded.sourceUrl || loaded.sourceDuration == null || !loaded.mediaFileId) {
    return { kind: "idle" };
  }

  if (resumePlan.target === "trimming" || metadata.clipEnd == null) {
    return {
      kind: "trimming",
      sourceFileName: loaded.sourceFileName,
      sourceDuration: loaded.sourceDuration,
      clipStart: metadata.clipStart,
      clipEnd: metadata.clipEnd,
    };
  }

  if (resumePlan.target !== "restoring") {
    return { kind: "idle" };
  }

  const clipEnd = metadata.clipEnd;
  return {
    kind: "restore",
    clipEnd,
    clipStart: metadata.clipStart,
    sourceFileName: loaded.sourceFileName,
    sourceDuration: loaded.sourceDuration,
    useFastPreviewRestore: resumePlan.skipToPreview,
    useWords: loaded.words.length > 0,
    words: loaded.words,
    previewOptions: {
      projectId,
      mediaFileId: loaded.mediaFileId,
      skipFaceDetect: resumePlan.skipFaceDetect,
      skipSubjectAnalysis: resumePlan.skipSubjectAnalysis,
      skipTrim: resumePlan.skipToPreview,
    },
  };
}

/** Synchronous pipeline state for first paint — avoids idle/upload flash before resume effect. */
export function deriveInitialPipelineState(
  loaded: ResumeLoadedInput | null,
  projectId: string,
): ClipperPipelineState {
  if (!loaded) return EMPTY_CLIPPER_PIPELINE_STATE;

  const plan = planResumeExecution(loaded, loaded.metadata, loaded.resumePlan, projectId);

  if (plan.kind === "idle") {
    return { ...EMPTY_CLIPPER_PIPELINE_STATE, stage: "idle" };
  }

  if (plan.kind === "trimming") {
    return {
      ...EMPTY_CLIPPER_PIPELINE_STATE,
      stage: "trimming",
      stageMessage: "Choose your source range",
      sourceFileName: plan.sourceFileName,
      sourceDuration: plan.sourceDuration,
      clipStart: plan.clipStart,
      clipEnd: plan.clipEnd,
    };
  }

  return {
    ...EMPTY_CLIPPER_PIPELINE_STATE,
    stage: "uploading",
    stageMessage: "Restoring trimmed video from project data…",
    sourceFileName: plan.sourceFileName,
    sourceDuration: plan.sourceDuration,
    clipStart: plan.clipStart,
    clipEnd: plan.clipEnd,
    clipSourceMode: loaded.metadata.clipSourceMode ?? "auto-parts",
    activeClipIndex: loaded.metadata.activeClipIndex ?? 0,
    stageProgress: 0,
  };
}
