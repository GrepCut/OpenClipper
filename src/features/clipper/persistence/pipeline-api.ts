import {
  localRecordDelete,
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database";

export type ClipperPipelineStepKey =
  | "confirm_range"
  | "transcribe"
  | "analyze_faces"
  | "analyze_subjects"
  | "preview_ready"
  | "render";
export type ClipperPipelineStepStatus =
  "pending" | "active" | "completed" | "failed" | "skipped";

export interface ClipperPipelineStepRecord {
  id: string;
  projectId: string;
  stepKey: ClipperPipelineStepKey;
  status: ClipperPipelineStepStatus;
  progress: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ClipperResumePlan {
  target: "trimming" | "restoring";
  skipTranscribe: boolean;
  skipFaceDetect: boolean;
  skipSubjectAnalysis: boolean;
  skipToPreview: boolean;
}

export interface ClipperFaceAnalysisRecord {
  id: string;
  projectId: string;
  mediaFileId: string;
  clipStart: number;
  clipEnd: number;
  detectorVersion: string;
  sampleCount: number;
  localDataPath: string;
  status: "pending" | "completed" | "failed";
  completedAt: string | null;
}

export interface ClipperPipelineStateResponse {
  steps: ClipperPipelineStepRecord[];
  resumePlan: ClipperResumePlan;
  faceAnalysis: ClipperFaceAnalysisRecord | null;
}

const STEPS = "clipper-pipeline-steps";
const FACE = "clipper-face-analysis";

function computeResumePlan(
  steps: ClipperPipelineStepRecord[],
): ClipperResumePlan {
  const completed = (key: ClipperPipelineStepKey) =>
    steps.find((step) => step.stepKey === key)?.status === "completed";
  if (!completed("confirm_range")) {
    return {
      target: "trimming",
      skipTranscribe: false,
      skipFaceDetect: false,
      skipSubjectAnalysis: false,
      skipToPreview: false,
    };
  }
  return {
    target: "restoring",
    skipTranscribe: completed("transcribe"),
    skipFaceDetect: completed("analyze_faces"),
    skipSubjectAnalysis: completed("analyze_subjects"),
    skipToPreview: completed("preview_ready"),
  };
}

async function getState(
  projectId: string,
): Promise<ClipperPipelineStateResponse> {
  const steps =
    (await localRecordGet<ClipperPipelineStepRecord[]>(STEPS, projectId)) ?? [];
  const faceAnalysis = await localRecordGet<ClipperFaceAnalysisRecord>(
    FACE,
    projectId,
  );
  return { steps, resumePlan: computeResumePlan(steps), faceAnalysis };
}

export const clipperPipelineService = {
  getPipeline: getState,

  upsertSteps: async (
    projectId: string,
    updates: Array<{
      stepKey: ClipperPipelineStepKey;
      status: ClipperPipelineStepStatus;
      progress?: number | null;
      errorMessage?: string | null;
      metadata?: Record<string, unknown> | null;
    }>,
  ): Promise<ClipperPipelineStateResponse> => {
    const current =
      (await localRecordGet<ClipperPipelineStepRecord[]>(STEPS, projectId)) ??
      [];
    const byKey = new Map(current.map((step) => [step.stepKey, step]));
    const now = new Date().toISOString();
    for (const update of updates) {
      const previous = byKey.get(update.stepKey);
      byKey.set(update.stepKey, {
        id: previous?.id ?? crypto.randomUUID(),
        projectId,
        stepKey: update.stepKey,
        status: update.status,
        progress: update.progress ?? previous?.progress ?? null,
        startedAt:
          previous?.startedAt ?? (update.status === "active" ? now : null),
        completedAt:
          update.status === "completed" ? now : (previous?.completedAt ?? null),
        errorMessage: update.errorMessage ?? null,
        metadata:
          update.metadata === undefined
            ? (previous?.metadata ?? null)
            : update.metadata,
      });
    }
    await localRecordPut(STEPS, projectId, projectId, [...byKey.values()]);
    return getState(projectId);
  },

  resetPipeline: async (projectId: string): Promise<void> => {
    await Promise.all([
      localRecordDelete(STEPS, projectId),
      localRecordDelete(FACE, projectId),
    ]);
  },

  upsertFaceAnalysis: async (
    projectId: string,
    payload: Omit<
      ClipperFaceAnalysisRecord,
      "id" | "projectId" | "completedAt"
    >,
  ): Promise<ClipperFaceAnalysisRecord> => {
    const previous = await localRecordGet<ClipperFaceAnalysisRecord>(
      FACE,
      projectId,
    );
    const record: ClipperFaceAnalysisRecord = {
      ...payload,
      id: previous?.id ?? crypto.randomUUID(),
      projectId,
      completedAt:
        payload.status === "completed" ? new Date().toISOString() : null,
    };
    return localRecordPut(FACE, projectId, projectId, record);
  },
};

export async function markClipperStepCompleted(
  projectId: string,
  stepKey: ClipperPipelineStepKey,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await clipperPipelineService.upsertSteps(projectId, [
    { stepKey, status: "completed", metadata: metadata ?? null },
  ]);
}

export function isClipperStepCompleted(
  steps: ClipperPipelineStepRecord[],
  stepKey: ClipperPipelineStepKey,
): boolean {
  return steps.find((step) => step.stepKey === stepKey)?.status === "completed";
}
