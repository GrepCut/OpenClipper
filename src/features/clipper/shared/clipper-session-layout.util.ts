import type { ClipperLayoutBackLink } from "../../../shared/components/back-link.component";
import type { ClipperLayoutStep } from "../components/clipper-layout.component";
import type {
  ClipperSessionLayoutState,
  ClipperSessionVisibilityInput,
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

/** Map session sub-routes → view mode. `/rendering` must be checked before `/render`. */
export function parseClipperSessionView(pathname: string, projectId: string): SessionViewMode {
  const base = `/clipper/${projectId}`;
  if (pathname === `${base}/exports` || pathname.startsWith(`${base}/exports/`)) return "exports";
  if (pathname === `${base}/rendering` || pathname.startsWith(`${base}/rendering/`)) {
    return "rendering";
  }
  if (pathname === `${base}/render` || pathname.startsWith(`${base}/render/`)) return "queue";
  return "preview";
}

export function clipperSessionPath(
  projectId: string,
  view: SessionViewMode = "preview",
): string {
  if (view === "exports") return `/clipper/${projectId}/exports`;
  if (view === "rendering") return `/clipper/${projectId}/rendering`;
  if (view === "queue") return `/clipper/${projectId}/render`;
  return `/clipper/${projectId}`;
}

export function resolveClipperSessionStep(
  stage: ClipperStage,
  view: SessionViewMode,
  isRendering: boolean,
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
      if (view === "rendering") {
        return {
          current: 3,
          total: 3,
          title: isRendering ? "Rendering…" : "Render complete",
        };
      }
      if (view === "queue") {
        return { current: 3, total: 3, title: "Render queue" };
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
    exportCount,
    loaded,
    clipPreviewsLength,
    autoPartsClipPreviewsLength,
    rangeTrimmedVideoUrl,
    onBackToPreview,
    onBackToRenderQueue,
  } = input;

  const clipCount = autoPartsClipPreviewsLength ?? clipPreviewsLength;
  const hasPreview = rangeTrimmedVideoUrl != null && clipCount > 0;
  const isRestoringSession =
    loaded?.resumePlan.target === "restoring" && !hasPreview && stage !== "error";
  const isPreparing = isPreparingStage(stage);
  const previewReady = hasPreview && isPreviewReadyStage(stage);

  const showUpload = stage === "idle" && !isRestoringSession;
  const showRestoreLoader = isRestoringSession;
  const showFreshProcessing = isPreparing && !hasPreview && !isRestoringSession;
  const showLoadingUi = showRestoreLoader || showFreshProcessing;
  const showPreview = previewReady && view === "preview";
  const showQueueSetup = previewReady && view === "queue";
  const showQueueProgress = previewReady && view === "rendering";
  const showExports =
    !showLoadingUi && view === "exports" && (previewReady || exportCount > 0);

  let layoutBackLink: ClipperLayoutBackLink | undefined;
  if (!showLoadingUi) {
    if (view === "queue") {
      layoutBackLink = { label: "Back to preview", onClick: onBackToPreview };
    } else if (view === "rendering" || view === "exports") {
      layoutBackLink = { label: "Back to render queue", onClick: onBackToRenderQueue };
    }
  }

  return {
    showUpload,
    showRestoreLoader,
    showFreshProcessing,
    showLoadingUi,
    showPreview,
    showQueue: showQueueSetup,
    showExports,
    showQueueSetup,
    showQueueProgress,
    layoutBackLink,
  };
}
