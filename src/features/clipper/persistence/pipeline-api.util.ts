import {
  localRecordDelete,
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database.util";

export type ClipperPipelineStepKey =
  | "confirm_range"
  | "transcribe"
  | "analyze_faces"
  | "analyze_subjects"
  | "preview_ready"
  | "render";
export type ClipperPipelineStepStatus =
  "pending" | "active" | "completed" | "failed" | "skipped";

/** First pipeline step a resume must re-run, or "preview" when everything is done. */
export type ClipperResumeStageKey =
  | "transcribe"
  | "analyze_faces"
  | "analyze_subjects"
  | "preview";

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
  faceAnalysis: ClipperFaceAnalysisRecord | null;
}

const STEPS = "clipper-pipeline-steps";
const FACE = "clipper-face-analysis";

/**
 * Serializes read-modify-write bursts per project. Every step record for a project
 * lives in one array under one key, so concurrent writers — a stage completing while
 * unmount cleanup demotes active steps — would otherwise clobber each other.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function queueProjectWrite<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(projectId) ?? Promise.resolve();
  const next = previous.then(task, task);
  writeQueues.set(
    projectId,
    next.catch(() => undefined),
  );
  return next;
}

export function clipRangeFromStepMetadata(
  steps: ClipperPipelineStepRecord[],
): { clipStart: number; clipEnd: number } | null {
  const step = steps.find((entry) => entry.stepKey === "confirm_range");
  const clipStart = step?.metadata?.clipStart;
  const clipEnd = step?.metadata?.clipEnd;
  if (typeof clipStart !== "number" || typeof clipEnd !== "number") return null;
  return { clipStart, clipEnd };
}

export function resolvePersistedClipRange(
  metadata: { clipStart: number; clipEnd: number | null },
  steps: ClipperPipelineStepRecord[],
): { clipStart: number; clipEnd: number | null } {
  if (metadata.clipEnd != null) {
    return { clipStart: metadata.clipStart, clipEnd: metadata.clipEnd };
  }
  const fromStep = clipRangeFromStepMetadata(steps);
  if (fromStep) return fromStep;
  return { clipStart: metadata.clipStart, clipEnd: null };
}

export function computeResumePlan(
  steps: ClipperPipelineStepRecord[],
  options?: { requiredAnalyzerVersion?: string; hasClipRange?: boolean },
): ClipperResumePlan {
  const completed = (key: ClipperPipelineStepKey) =>
    steps.find((step) => step.stepKey === key)?.status === "completed";
  const hasRange = options?.hasClipRange === true || clipRangeFromStepMetadata(steps) != null;
  if (!completed("confirm_range") || !hasRange) {
    return {
      target: "trimming",
      skipTranscribe: false,
      skipFaceDetect: false,
      skipSubjectAnalysis: false,
      skipToPreview: false,
    };
  }
  const subjectStep = steps.find((step) => step.stepKey === "analyze_subjects");
  const savedAnalyzerVersion = typeof subjectStep?.metadata?.analyzerVersion === "string"
    ? subjectStep.metadata.analyzerVersion
    : undefined;
  const subjectAnalysisCurrent = options?.requiredAnalyzerVersion == null
    || savedAnalyzerVersion === options.requiredAnalyzerVersion;
  return {
    target: "restoring",
    skipTranscribe: completed("transcribe"),
    skipFaceDetect: completed("analyze_faces"),
    // Face detections can be restored, but a changed layout/identity policy
    // must rebuild the AutoFlip track from fresh subject extraction.
    skipSubjectAnalysis: completed("analyze_subjects") && subjectAnalysisCurrent,
    skipToPreview: completed("preview_ready"),
  };
}

/** The phase a resume must restart, derived from completed steps only. */
export function resumeStageForPlan(plan: ClipperResumePlan): ClipperResumeStageKey {
  if (!plan.skipTranscribe) return "transcribe";
  if (!plan.skipFaceDetect) return "analyze_faces";
  if (!plan.skipSubjectAnalysis) return "analyze_subjects";
  return "preview";
}

/** Raw persisted pipeline state. The resume plan is derived by the caller, which also
 *  knows whether a clip range survived — see `computeResumePlan`. */
async function getState(projectId: string): Promise<ClipperPipelineStateResponse> {
  const steps =
    (await localRecordGet<ClipperPipelineStepRecord[]>(STEPS, projectId)) ?? [];
  const faceAnalysis = await localRecordGet<ClipperFaceAnalysisRecord>(
    FACE,
    projectId,
  );
  return { steps, faceAnalysis };
}

interface ClipperStepUpdate {
  stepKey: ClipperPipelineStepKey;
  status: ClipperPipelineStepStatus;
  progress?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

async function applyStepUpdates(
  projectId: string,
  updates: ClipperStepUpdate[],
): Promise<ClipperPipelineStepRecord[]> {
  const current =
    (await localRecordGet<ClipperPipelineStepRecord[]>(STEPS, projectId)) ?? [];
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
  const steps = [...byKey.values()];
  await localRecordPut(STEPS, projectId, projectId, steps);
  return steps;
}

export const clipperPipelineService = {
  getPipeline: getState,

  upsertSteps: (
    projectId: string,
    updates: ClipperStepUpdate[],
  ): Promise<ClipperPipelineStepRecord[]> =>
    queueProjectWrite(projectId, () => applyStepUpdates(projectId, updates)),

  resetPipeline: (projectId: string): Promise<void> =>
    queueProjectWrite(projectId, async () => {
      await Promise.all([
        localRecordDelete(STEPS, projectId),
        localRecordDelete(FACE, projectId),
      ]);
    }),

  upsertFaceAnalysis: (
    projectId: string,
    payload: Omit<
      ClipperFaceAnalysisRecord,
      "id" | "projectId" | "completedAt"
    >,
  ): Promise<ClipperFaceAnalysisRecord> =>
    queueProjectWrite(projectId, async () => {
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
    }),
};

export async function markClipperStepCompleted(
  projectId: string,
  stepKey: ClipperPipelineStepKey,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // `undefined` keeps whatever metadata the step already carries — re-completing
  // confirm_range must never erase the persisted clip range.
  await clipperPipelineService.upsertSteps(projectId, [
    { stepKey, status: "completed", metadata },
  ]);
}

export async function markClipperStepActive(
  projectId: string,
  stepKey: ClipperPipelineStepKey,
  options?: { progress?: number | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await clipperPipelineService.upsertSteps(projectId, [
    { stepKey, status: "active", progress: options?.progress, metadata: options?.metadata },
  ]);
}

export async function markClipperStepFailed(
  projectId: string,
  stepKey: ClipperPipelineStepKey,
  errorMessage: string,
): Promise<void> {
  await queueProjectWrite(projectId, async () => {
    const current =
      (await localRecordGet<ClipperPipelineStepRecord[]>(STEPS, projectId)) ?? [];
    // Work that already finished stays finished — a later phase blowing up must not
    // force the earlier ones to run again on retry.
    if (current.some((step) => step.stepKey === stepKey && step.status === "completed")) {
      return;
    }
    await applyStepUpdates(projectId, [{ stepKey, status: "failed", errorMessage }]);
  });
}

/** Demotes steps left `active` by an abort/crash so they re-run; never touches completed work. */
export async function clearActiveClipperSteps(projectId: string): Promise<void> {
  await queueProjectWrite(projectId, async () => {
    const current =
      (await localRecordGet<ClipperPipelineStepRecord[]>(STEPS, projectId)) ?? [];
    const active = current.filter((step) => step.status === "active");
    if (active.length === 0) return;
    await applyStepUpdates(
      projectId,
      active.map((step) => ({
        stepKey: step.stepKey,
        status: "pending" as const,
      })),
    );
  });
}

export function isClipperStepCompleted(
  steps: ClipperPipelineStepRecord[],
  stepKey: ClipperPipelineStepKey,
): boolean {
  return steps.find((step) => step.stepKey === stepKey)?.status === "completed";
}
