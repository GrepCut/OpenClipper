import type { RangeFrameContextGetter } from "../engine/types/render.types";
import type { CollageRegion } from "../engine/types/collage.types";
import type { AiClipSegmentRange } from "../engine/types/transcript.types";
import type { ClipperClipPreview, ClipSourceMode, WordCue } from "../shared/state.util";
import type { AutoPartsSegmentLengthSec } from "../persistence/project-metadata.util";

/** Adds a manual clip, or replaces the range of clip `editIndex`. */
export type UpsertManualClipHandler = (range: AiClipSegmentRange, editIndex?: number) => void;

export interface ClipperClipsSectionProps {
  projectId: string;
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  manualClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
  onDeleteManualClip?: (index: number) => void;
  onUpsertManualClip?: UpsertManualClipHandler;
  onOpenInStudio?: (index: number) => void;
  openingInStudio?: boolean;
  rangeWords: WordCue[];
  collageRegions: CollageRegion[];
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void;
  autoPartsSegmentLengthSec: AutoPartsSegmentLengthSec;
  onAutoPartsSegmentLengthChange: (lengthSec: AutoPartsSegmentLengthSec) => void;
  onResetAutoParts?: () => void;
  autoPartsResegmenting?: boolean;
  rangeTrimmedVideoUrl: string | null;
  rangeDurationSec: number;
  getRangeFrameContext?: RangeFrameContextGetter;
  onManualEditorOpen?: () => void;
}

export type ClipperManualClipsSectionProps = Pick<
  ClipperClipsSectionProps,
  | "clipPreviews"
  | "activeClipIndex"
  | "onSelectClip"
  | "onOpenInStudio"
  | "openingInStudio"
  | "rangeWords"
  | "collageRegions"
  | "disabledCollageRegionIds"
  | "onToggleCollageRegion"
  | "onSeekToTranscriptTime"
  | "getRangeFrameContext"
  | "onManualEditorOpen"
  | "onDeleteManualClip"
  | "onUpsertManualClip"
  | "rangeTrimmedVideoUrl"
  | "rangeDurationSec"
>;

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
