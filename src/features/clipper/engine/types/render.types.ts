import type { CaptionGroup } from "../../lib/media/transcription-export.util";
import type { ClipperLayoutMode } from "../../shared/smart-crop.util";
import type { ClipperSettings } from "../../settings/settings.util";
import type { FaceSampleCache } from "../reframe/cache.util";
import type { ClipperClipSegmentWindow } from "./segmentation.types";
import type {
  CollageAspectEligibility,
  CollageRegion,
  CollageTracks,
} from "./collage.types";
import type { CentroidSample, ClipperCropRect } from "./reframe.types";
import type { ClipperSmartCropBlob } from "../../shared/smart-crop.util";

export interface ClipperClipWindow {
  /**
   * Source-video time windows to encode, concatenated in order into one
   * continuous output (video + audio). A plain contiguous export has one
   * segment; an AI "supercut" clip may have several disjoint ones.
   */
  segments: ClipperClipSegmentWindow[];
}

export type RenderClipperResult =
  | { kind: "memory"; blob: Blob }
  | { kind: "disk-encoded" };

export interface ResolvedClipperLayout {
  mode: ClipperLayoutMode;
  viewports: ClipperCropRect[];
  solidBackgroundColor?: { r: number; g: number; b: number };
  reasonCodes?: string[];
  requiredRegionIds?: string[];
  subjectDisplayHeightFractions?: number[];
}

/** Everything needed to render one frame's crop + captions for a given settings snapshot. */
export interface ClipperFrameContext {
  settings: ClipperSettings;
  captionGroups: CaptionGroup[];
  faceCache: FaceSampleCache | null;
  faceRender?: {
    focusTrack: CentroidSample[];
    collageTracks: CollageTracks;
    collageRegions: CollageRegion[];
    collageEligibility: CollageAspectEligibility;
  };
  smartCropAnalysis?: ClipperSmartCropBlob | null;
  disabledCollageRegionIds: string[];
  segments?: ClipperClipSegmentWindow[];
}

export interface RebasingVideoSample {
  timestamp: number;
  duration: number;
}

export interface RebasingMediaTimestamp {
  timestamp: number;
  timeOffset: number;
}
