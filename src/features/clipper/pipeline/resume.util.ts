import type { ClipperProjectMetadata } from "../persistence/project-metadata.util";
import type {
  ClipperPipelineStepRecord,
  ClipperResumePlan,
  ClipperResumeStageKey,
} from "../persistence/pipeline-api.util";
import {
  resolvePersistedClipRange,
  resumeStageForPlan,
} from "../persistence/pipeline-api.util";
import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperPipelineState } from "../shared/state.util";
import type { ClipperStage } from "../shared/stages.util";

export const EMPTY_CLIPPER_PIPELINE_STATE: ClipperPipelineState = {
  stage: "idle",
  stageMessage: "",
  renderProgress: {},
  exportHistory: [],
  rangeTrimmedVideoUrl: null,
  clipPreviews: [],
  autoPartsClipPreviews: [],
  aiClipPreviews: [],
  manualClipPreviews: [],
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
  stageDetailLabel: null,
  stageDetailProgress: null,
};

/** UI stage each resumable phase should paint while it re-runs. */
const RESUME_STAGE_UI: Record<
  ClipperResumeStageKey,
  { stage: ClipperStage; message: string }
> = {
  transcribe: { stage: "transcribing", message: "Resuming transcription…" },
  analyze_faces: { stage: "analyzing-faces", message: "Resuming face detection…" },
  analyze_subjects: {
    stage: "analyzing-subjects",
    message: "Resuming subject analysis…",
  },
  preview: { stage: "uploading", message: "Restoring your preview…" },
};

function resumeStageUi(stage: ClipperResumeStageKey): {
  stage: ClipperStage;
  message: string;
} {
  return RESUME_STAGE_UI[stage];
}

/** Shown when a project is reopened after a phase failed and waits for an explicit retry. */
export const RESUME_ERROR_MESSAGE =
  "This project stopped with an error. Resume to try that step again.";

export interface ResumeLoadedInput {
  metadata: ClipperProjectMetadata;
  sourceFile: File | null;
  sourceUrl: string | null;
  sourceDuration: number | null;
  sourceFileName: string | null;
  mediaFileId: string | null;
  words: WordCue[];
  resumePlan: ClipperResumePlan;
  steps?: ClipperPipelineStepRecord[];
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

export interface ResumePreviewOptions {
  projectId: string;
  mediaFileId: string;
  skipFaceDetect: boolean;
  skipSubjectAnalysis: boolean;
  skipTrim: boolean;
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
      /** Last run of this phase failed — show the error and wait for an explicit retry. */
      kind: "error";
      resumeStage: ClipperResumeStageKey;
      clipStart: number;
      clipEnd: number;
      sourceFileName: string | null;
      sourceDuration: number | null;
    }
  | {
      kind: "restore";
      clipEnd: number;
      /** The phase this resume restarts, derived from completed steps. */
      resumeStage: ClipperResumeStageKey;
      /** True when transcription has to run before the preview pipeline. */
      needsTranscribe: boolean;
      previewOptions: ResumePreviewOptions;
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

  const range = resolvePersistedClipRange(metadata, loaded.steps ?? []);

  if (resumePlan.target === "trimming" || range.clipEnd == null) {
    return {
      kind: "trimming",
      sourceFileName: loaded.sourceFileName,
      sourceDuration: loaded.sourceDuration,
      clipStart: range.clipStart,
      clipEnd: range.clipEnd,
    };
  }

  if (resumePlan.target !== "restoring") {
    return { kind: "idle" };
  }

  const clipEnd = range.clipEnd;
  const resumeStage = resumeStageForPlan(resumePlan);

  // A phase that ended in an error must not auto-restart — it would loop on a
  // permanent failure. The user retries explicitly from the error panel.
  if (metadata.stage === "error") {
    return {
      kind: "error",
      resumeStage,
      clipStart: range.clipStart,
      clipEnd,
      sourceFileName: loaded.sourceFileName,
      sourceDuration: loaded.sourceDuration,
    };
  }

  return {
    kind: "restore",
    clipEnd,
    clipStart: range.clipStart,
    resumeStage,
    needsTranscribe: !resumePlan.skipTranscribe,
    sourceFileName: loaded.sourceFileName,
    sourceDuration: loaded.sourceDuration,
    words: loaded.words,
    previewOptions: {
      projectId,
      mediaFileId: loaded.mediaFileId,
      skipFaceDetect: resumePlan.skipFaceDetect,
      skipSubjectAnalysis: resumePlan.skipSubjectAnalysis,
      // The range is already confirmed, so the trimmed segment on disk is valid for
      // it. runTrimStage re-extracts on its own when the file is missing or stale.
      skipTrim: true,
    },
  };
}

type ResumePlanStateFields = Pick<
  ClipperPipelineState,
  "stage" | "stageMessage" | "sourceFileName" | "sourceDuration" | "clipStart" | "clipEnd"
>;

/**
 * Stage, message and source fields implied by a plan. Shared by the first paint
 * (`deriveInitialPipelineState`) and the resume effect, so both cannot drift apart.
 */
export function resumePlanStateFields(
  plan: Exclude<ResumePlan, { kind: "idle" }>,
): ResumePlanStateFields {
  const { sourceFileName, sourceDuration, clipStart, clipEnd } = plan;

  if (plan.kind === "trimming") {
    return {
      stage: "trimming",
      stageMessage: "Choose your source range",
      sourceFileName,
      sourceDuration,
      clipStart,
      clipEnd,
    };
  }

  if (plan.kind === "error") {
    return {
      stage: "error",
      stageMessage: "Something went wrong",
      sourceFileName,
      sourceDuration,
      clipStart,
      clipEnd,
    };
  }

  const ui = resumeStageUi(plan.resumeStage);
  return {
    stage: ui.stage,
    stageMessage: ui.message,
    sourceFileName,
    sourceDuration,
    clipStart,
    clipEnd,
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

  const fields = resumePlanStateFields(plan);

  if (plan.kind === "trimming") {
    return { ...EMPTY_CLIPPER_PIPELINE_STATE, ...fields };
  }

  if (plan.kind === "error") {
    return { ...EMPTY_CLIPPER_PIPELINE_STATE, ...fields, error: RESUME_ERROR_MESSAGE };
  }

  return {
    ...EMPTY_CLIPPER_PIPELINE_STATE,
    ...fields,
    clipSourceMode: loaded.metadata.clipSourceMode ?? "auto-parts",
    activeClipIndex: loaded.metadata.activeClipIndex ?? 0,
    stageProgress: 0,
  };
}
