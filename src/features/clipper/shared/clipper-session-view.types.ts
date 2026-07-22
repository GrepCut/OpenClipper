import type { Project } from "../../../services/projects.service";
import type { ClipperLayoutBackLink } from "../components/clipper-layout.component";
import type { ClipperLoadedProject } from "../hooks/use-clipper-project-loader.hook";

export interface ClipperSessionViewProps {
  project: Project;
  token: string | null;
  loaded: ClipperLoadedProject | null;
}

export type SessionViewMode = "preview" | "queue" | "exports";

export type QueuePhase = "setup" | "progress" | "complete";

export interface ClipperSessionVisibility {
  showUpload: boolean;
  showRestoreLoader: boolean;
  showFreshProcessing: boolean;
  showLoadingUi: boolean;
  showPreview: boolean;
  showQueue: boolean;
  showExports: boolean;
  showQueueSetup: boolean;
  showQueueProgress: boolean;
}

export interface ClipperSessionLayoutState extends ClipperSessionVisibility {
  layoutBackLink?: ClipperLayoutBackLink;
}

export interface ClipperSessionVisibilityInput {
  stage: import("./stages.util").ClipperStage;
  view: SessionViewMode;
  queuePhase: QueuePhase;
  exportCount: number;
  loaded: ClipperLoadedProject | null;
  clipPreviewsLength: number;
  autoPartsClipPreviewsLength: number | undefined;
  rangeTrimmedVideoUrl: string | null;
  onBackToPreview: () => void;
}
