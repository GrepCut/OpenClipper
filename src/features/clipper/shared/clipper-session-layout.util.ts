import type { ClipperLayoutStep } from "../components/clipper-layout.component";
import type {
  ClipperSessionLayoutState,
  ClipperSessionVisibilityInput,
  QueuePhase,
  SessionViewMode,
} from "./clipper-session-view.types";
import type { ClipperStage } from "./stages.util";

const PREPARING_STAGES: ClipperStage[] = [
  "uploading",
  "transcribing",
  "analyzing-faces",
  "analyzing-subjects",
];

const PREVIEW_READY_STAGES: ClipperStage[] = ["preview", "rendering", "done"];

function isPreparingStage(stage: ClipperStage): boolean {
  return PREPARING_STAGES.includes(stage);
}

function isPreviewReadyStage(stage: ClipperStage): boolean {
  return PREVIEW_READY_STAGES.includes(stage);
}

export function resolveClipperSessionStep(
  stage: ClipperStage,
  view: SessionViewMode,
  queuePhase: QueuePhase,
): ClipperLayoutStep | undefined {
  switch (stage) {
    case "trimming":
      return { current: 1, total: 3, title: "Choose your source range" };
    case "uploading":
    case "transcribing":
    case "analyzing-faces":
    case "analyzing-subjects":
      return { current: 2, total: 3, title: "Transcribing & preparing clips" };
    case "preview":
    case "rendering":
    case "done":
      if (view === "exports") return { title: "Your exports" };
      if (view === "queue") {
        return {
          current: 3,
          total: 3,
          title:
            queuePhase === "progress"
              ? "Rendering…"
              : queuePhase === "complete"
                ? "Render complete"
                : "Render queue",
        };
      }
      return { current: 3, total: 3, title: "Preview & customize" };
    case "error":
      return { title: "Something went wrong" };
    default:
      return undefined;
  }
}

export function resolveClipperSessionVisibility(
  input: ClipperSessionVisibilityInput,
): ClipperSessionLayoutState {
  const {
    stage,
    view,
    queuePhase,
    exportCount,
    loaded,
    clipPreviewsLength,
    autoPartsClipPreviewsLength,
    rangeTrimmedVideoUrl,
    onBackToPreview,
  } = input;

  const clipCount = autoPartsClipPreviewsLength ?? clipPreviewsLength;
  const hasPreview = rangeTrimmedVideoUrl != null && clipCount > 0;
  const isRestoringSession =
    loaded?.resumePlan.target === "restoring" && !hasPreview && stage !== "error";
  const isPreparing = isPreparingStage(stage);

  const showUpload = stage === "idle" && !isRestoringSession;
  const showRestoreLoader = isRestoringSession;
  const showFreshProcessing = isPreparing && !hasPreview && !isRestoringSession;
  const showLoadingUi = showRestoreLoader || showFreshProcessing;
  const canShowExports = hasPreview && exportCount > 0;
  const showPreview = hasPreview && view === "preview" && isPreviewReadyStage(stage);
  const showQueue = hasPreview && view === "queue" && isPreviewReadyStage(stage);
  const showExports = canShowExports && view === "exports";
  const showQueueSetup = showQueue && queuePhase === "setup";
  const showQueueProgress = showQueue && (queuePhase === "progress" || queuePhase === "complete");

  const layoutBackLink =
    showExports || showQueue
      ? { label: "Back to preview", onClick: onBackToPreview }
      : undefined;

  return {
    showUpload,
    showRestoreLoader,
    showFreshProcessing,
    showLoadingUi,
    showPreview,
    showQueue,
    showExports,
    showQueueSetup,
    showQueueProgress,
    layoutBackLink,
  };
}
