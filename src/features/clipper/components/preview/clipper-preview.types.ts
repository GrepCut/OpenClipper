import type React from "react";
import type { Theme } from "../../../../theme";
import type { CollageRegion } from "../../engine/reframe/collage";
import type { ClipperFrameContext } from "../../engine/render/index";
import type { ClipperClipSegmentWindow } from "../../engine/segmentation";
import type { ClipTranscriptEditOp } from "../../engine/transcript";
import type {
  ClipperAiChatMessage,
  ClipperAiClipPickerModel,
} from "../../persistence/ai-clip-api.util";
import type { AutoPartsSegmentLengthSec } from "../../persistence/project-metadata.util";
import type { ClipperSettings } from "../../settings/settings.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import type { ClipperClipPreview, ClipperPipelineState, ClipSourceMode } from "../../shared/state.util";
import type { SidePanelTab } from "./clipper-preview.constants";

export interface ClipperPreviewProps {
  projectId: string;
  state: ClipperPipelineState;
  rangeTrimmedVideoUrl: string;
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onClipSourceModeChange: (mode: ClipSourceMode) => void;
  aiChatMessages: ClipperAiChatMessage[];
  aiChatLoading: boolean;
  aiChatError: string | null;
  aiChatThinking: string;
  aiChatProgressChars: number;
  aiChatModel: ClipperAiClipPickerModel;
  onAiChatModelChange: (model: ClipperAiClipPickerModel) => void;
  onSendAiChatMessage: (message: string, preset?: string) => void;
  onLoadAiChatHistory: () => void;
  onNewAiChat?: () => void;
  aiCurrentClipsJsonChars?: number;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
  settings: ClipperSettings;
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  getFrameContext: () => ClipperFrameContext | null;
  sourceFileName: string | null;
  isRendering?: boolean;
  exportCount?: number;
  onViewExports?: () => void;
  onOpenRenderQueue: () => void;
  /** Blocks AI tab when account is not available; returns false when blocked. */
  guardAccount?: () => boolean;
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  autoPartsSegmentLengthSec: AutoPartsSegmentLengthSec;
  onAutoPartsSegmentLengthChange: (lengthSec: AutoPartsSegmentLengthSec) => void;
  onResetAutoParts?: () => void;
  autoPartsResegmenting?: boolean;
  onEditClipTranscript?: (clipIndex: number, op: ClipTranscriptEditOp) => void;
  onUndoClipEdit?: () => void;
  onRedoClipEdit?: () => void;
  canUndoClipEdit?: boolean;
  canRedoClipEdit?: boolean;
  lastEditedTranscriptRange?: { clipIndex: number; startIdx: number; endIdx: number } | null;
}

export interface UseClipperPreviewPlaybackParams {
  rangeTrimmedVideoUrl: string;
  activeClipIndex: number;
  clipStartSec: number;
  clipEndSec: number;
  clipDuration: number;
  clipSegments: ClipperClipSegmentWindow[];
  playbackStart: number;
  playbackEnd: number;
  previewFormats: ClipperFormatDef[];
  primaryFormat: ClipperFormatDef | undefined;
  getFrameContext: () => ClipperFrameContext | null;
  settings: ClipperSettings;
  onSelectClip: (index: number) => void;
}

export interface ClipperPreviewTimelineProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  segments: ClipperClipSegmentWindow[];
  clipDuration: number;
  activeClipIndex: number;
}

export interface ClipperPreviewPlayOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeClipIndex: number;
  onTogglePlay: () => void;
}

export interface ClipperPreviewHeroSectionProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRefs: React.MutableRefObject<Record<string, HTMLCanvasElement | null>>;
  primaryFormat: ClipperFormatDef | undefined;
  clipSegments: ClipperClipSegmentWindow[];
  clipDuration: number;
  activeClipIndex: number;
  sourceFileName: string | null;
  theme: Theme;
  onTogglePlay: () => void;
}

export interface ClipperPreviewSidePanelProps extends ClipperPreviewProps {
  theme: Theme;
  safeAutoPartsPreviews: ClipperClipPreview[];
  safeAiPreviews: ClipperClipPreview[];
  collageRegions: CollageRegion[];
  seekToTranscriptTime: (clipIndex: number, sourceTimeSec: number) => void;
  sidePanelTab: SidePanelTab;
  onSidePanelTabChange: (tab: SidePanelTab) => void;
}

export interface ClipperPreviewFormatsFooterProps {
  secondaryFormats: ClipperFormatDef[];
  canvasRefs: React.MutableRefObject<Record<string, HTMLCanvasElement | null>>;
  exportCount: number;
  isRendering: boolean;
  onViewExports?: () => void;
  outlineButton: Record<string, unknown>;
}
