import type { ClipperAspectPresetId } from "../../shared/formats";
import type { FaceBox } from "../../shared/face-samples";
import type { ClipperCropRect, CentroidSample } from "./reframe";

export interface CollageTracks {
  top: CentroidSample[];
  bottom: CentroidSample[];
  hasTwoSpeakers: boolean;
}

export interface CollageEligibilityWindow {
  regionId: string;
  start: number;
  end: number;
}

export type CollageAspectEligibility = Record<ClipperAspectPresetId, CollageEligibilityWindow[]>;

export interface FacePair {
  left: FaceBox;
  right: FaceBox;
}

/** A contiguous time window where two speakers were stably detected side by side. */
export interface CollageRegion {
  id: string;
  start: number;
  end: number;
  /** true = the left half of frame is the dominant (top) speaker for this region's whole span. */
  topIsLeft: boolean;
}

export interface PodcastCollageLayout {
  halfH: number;
  bottomH: number;
  topCrop: ClipperCropRect;
  bottomCrop: ClipperCropRect;
}
