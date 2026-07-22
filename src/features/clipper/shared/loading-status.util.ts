import { yieldToMain } from "./yield-to-main.util";
import type { ClipperStage } from "./stages.util";
import { isClipperPreviewReadyStage } from "./stages.util";

export type ClipperLoadingStepStatus = "pending" | "active" | "done";

export interface ClipperLoadingStepDef {
  id: string;
  label: string;
}

export interface ClipperLoadingStep extends ClipperLoadingStepDef {
  status: ClipperLoadingStepStatus;
}

export interface ClipperLoadingStatus {
  message: string;
  detail?: string;
  steps?: ClipperLoadingStep[];
  /** Wall-clock ms when the current phase started — used for live elapsed display. */
  phaseStartedAt?: number;
}

export function markStepActive(
  steps: ClipperLoadingStepDef[],
  activeId: string,
): ClipperLoadingStep[] {
  let seenActive = false;
  return steps.map((step) => {
    if (step.id === activeId) {
      seenActive = true;
      return { ...step, status: "active" as const };
    }
    if (!seenActive) {
      return { ...step, status: "done" as const };
    }
    return { ...step, status: "pending" as const };
  });
}

export function markAllStepsDone(steps: ClipperLoadingStepDef[]): ClipperLoadingStep[] {
  return steps.map((step) => ({ ...step, status: "done" as const }));
}

export async function reportLoadingStep(
  apply: (status: ClipperLoadingStatus) => void,
  steps: ClipperLoadingStepDef[],
  stepId: string,
  message: string,
  detail?: string,
): Promise<void> {
  apply({
    message,
    detail,
    steps: markStepActive(steps, stepId),
    phaseStartedAt: Date.now(),
  });
  await yieldToMain();
}

export const CLIPPER_SESSION_BOOT_STEPS: ClipperLoadingStepDef[] = [
  { id: "fetch", label: "Fetch project from server" },
  { id: "metadata", label: "Read project metadata" },
  { id: "sync", label: "Initialize local project sync" },
  { id: "pipeline", label: "Load pipeline state from server" },
  { id: "source", label: "Locate source video file" },
  { id: "transcription", label: "Restore transcription" },
  { id: "finalize", label: "Prepare workspace" },
  { id: "trim", label: "Restore trimmed video segment" },
  { id: "segments", label: "Rebuild clip segments" },
  { id: "analysis", label: "Analyze faces & smart crop" },
  { id: "preview", label: "Open preview workspace" },
];

/** Marks every step through `throughId` as done; later steps stay pending. */
export function markStepsThroughDone(
  steps: ClipperLoadingStepDef[],
  throughId: string,
): ClipperLoadingStep[] {
  let throughSeen = false;
  return steps.map((step) => {
    if (step.id === throughId) {
      throughSeen = true;
      return { ...step, status: "done" as const };
    }
    return { ...step, status: throughSeen ? ("pending" as const) : ("done" as const) };
  });
}

/** Steps from the start through the active one — list only grows, never shrinks. */
export function visibleBootSteps(steps: ClipperLoadingStep[]): ClipperLoadingStep[] {
  const activeIndex = steps.findIndex((step) => step.status === "active");
  if (activeIndex >= 0) {
    return steps.slice(0, activeIndex + 1);
  }
  const lastDoneIndex = steps.findLastIndex((step) => step.status === "done");
  if (lastDoneIndex >= 0) {
    return steps.slice(0, lastDoneIndex + 1);
  }
  return steps.slice(0, 1);
}

/** True when the boot-step loader should run (re-open of a project already at preview+). */
export function isRestoreBootFlow(
  resumePlan?: { target: "trimming" | "restoring" } | null,
  metadataStage?: ClipperStage,
): boolean {
  if (resumePlan) return resumePlan.target === "restoring";
  return isClipperPreviewReadyStage(metadataStage ?? "idle");
}

export function simpleLoadingStatus(message: string): ClipperLoadingStatus {
  return { message, phaseStartedAt: Date.now() };
}

export function resumeStepsForStage(
  stage: string,
  stageMessage?: string,
): ClipperLoadingStatus {
  const lower = stageMessage?.toLowerCase() ?? "";
  let activeId = "trim";
  if (stage === "preview") {
    activeId = "preview";
  } else if (stage === "analyzing-faces" || stage === "analyzing-subjects") {
    activeId = "analysis";
  } else if (stage === "transcribing") {
    activeId = "segments";
  } else if (
    stage === "uploading" &&
    (lower.includes("keyframe") ||
      lower.includes("rebuilding clips") ||
      lower.includes("boundaries") ||
      lower.includes("segment"))
  ) {
    activeId = "segments";
  }

  return {
    message: stageMessage?.trim() || "Restoring your clip session…",
    detail: resumeDetailForStage(stage, stageMessage),
    steps: markStepActive(CLIPPER_SESSION_BOOT_STEPS, activeId),
    phaseStartedAt: Date.now(),
  };
}

function resumeDetailForStage(stage: string, stageMessage?: string): string | undefined {
  const lower = stageMessage?.toLowerCase() ?? "";
  if (lower.includes("saved boundaries") || lower.includes("rebuilding clips from saved")) {
    return "Using cached clip boundaries — skipping mediabunny keyframe scan";
  }
  if (lower.includes("keyframe")) {
    return "Scanning video keyframes — this can take a few seconds on long clips";
  }
  if ((stage === "analyzing-faces" || stage === "analyzing-subjects") && lower.includes("restor")) {
    return "Reading face and smart crop analysis from local project data";
  }
  if (stage === "analyzing-faces" || stage === "analyzing-subjects") {
    return "Detecting faces, tracking subjects, and salient motion locally";
  }
  if (stage === "uploading" && lower.includes("trim")) {
    return "Reading clip-trimmed.mp4 from Tauri project data directory";
  }
  if (stage === "transcribing") {
    return "Waiting for speech-to-text from the server";
  }
  return undefined;
}
