import type React from "react";
import type { Theme } from "../../../../theme";
import type { CollageRegion } from "../../engine/reframe/collage";
import type { ClipperFrameContext } from "../../engine/render/index";
import type { ClipperClipSegmentWindow } from "../../engine/segmentation";
import type { AutoPartsSegmentLengthSec } from "../../persistence/project-metadata.util";
import type { ClipperSettings } from "../../settings/settings.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import type { ClipperClipPreview, ClipperPipelineState, ClipSourceMode } from "../../shared/state.util";
import type { SidePanelTab } from "./clipper-preview.constants";

export interface ClipperPreviewProps {
  projectId: string;
  state: ClipperPipelineState;
  rangeTrimmedVideoUrl: string | null;
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onClipSourceModeChange: (mode: ClipSourceMode) => void;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
  settings: ClipperSettings;
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  getFrameContext: (clipIndex?: number) => ClipperFrameContext | null;
  sourceFileName: string | null;
  isRendering?: boolean;
  onOpenRenderQueue: () => void;
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  autoPartsSegmentLengthSec: AutoPartsSegmentLengthSec;
  onAutoPartsSegmentLengthChange: (lengthSec: AutoPartsSegmentLengthSec) => void;
  onResetAutoParts?: () => void;
  autoPartsResegmenting?: boolean;
  settingsDrawerVisible?: boolean;
  onOpenInStudio?: (clipIndex: number) => void;
  openingInStudio?: boolean;
}

export interface UseClipperPreviewPlaybackParams {
  rangeTrimmedVideoUrl: string | null;
  previewActive?: boolean;
  activeClipIndex: number;
  clipStartSec: number;
  clipEndSec: number;
  clipDuration: number;
  clipSegments: ClipperClipSegmentWindow[];
  playbackStart: number;
  playbackEnd: number;
  previewFormats: ClipperFormatDef[];
  primaryFormat: ClipperFormatDef | undefined;
  getFrameContext: (clipIndex?: number) => ClipperFrameContext | null;
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
  registerCanvas: (formatId: string, canvas: HTMLCanvasElement | null) => void;
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
  registerCanvas: (formatId: string, canvas: HTMLCanvasElement | null) => void;
}
