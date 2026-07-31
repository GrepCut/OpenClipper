import type { CollageRegion } from "../engine/types/collage.types";
import type { ClipperClipPreview, ClipSourceMode, WordCue } from "../shared/state.util";
import type { AutoPartsSegmentLengthSec } from "../persistence/project-metadata.util";

export interface ClipperClipsSectionProps {
  projectId: string;
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
  rangeWords: WordCue[];
  collageRegions: CollageRegion[];
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void;
  autoPartsSegmentLengthSec: AutoPartsSegmentLengthSec;
  onAutoPartsSegmentLengthChange: (lengthSec: AutoPartsSegmentLengthSec) => void;
  onResetAutoParts?: () => void;
  autoPartsResegmenting?: boolean;
}

export const CLIPS_LIST_FADE_HEIGHT = "56px";
export const AUTO_PARTS_LENGTH_OVERLAY_PAD = "80px";

export function clipSelectorTranscriptProps(
  rangeWords: WordCue[],
  collageRegions: CollageRegion[],
  disabledCollageRegionIds: string[],
  onToggleCollageRegion: (regionId: string) => void,
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void,
) {
  return {
    rangeWords,
    collageRegions,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    onSeekToTranscriptTime,
  };
}
