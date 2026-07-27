import type { CollageRegion } from "../engine/types/collage.types";
import type {
  ClipperAiChatMessage,
  ClipperAiClipPickerModel,
} from "../persistence/ai-clip-api.util";
import type { ClipperClipPreview, ClipSourceMode, WordCue } from "../shared/state.util";
import type { ClipTranscriptEditOp } from "../engine/transcript";
import type { AutoPartsSegmentLengthSec } from "../persistence/project-metadata.util";

export interface ClipperClipsSectionProps {
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  onDeleteAiClip?: (index: number) => void;
  onDeleteAutoPartsClip?: (index: number) => void;
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
  rangeWords: WordCue[];
  collageRegions: CollageRegion[];
  disabledCollageRegionIds: string[];
  onToggleCollageRegion: (regionId: string) => void;
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void;
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

export const CLIPS_LIST_FADE_HEIGHT = "56px";
export const AUTO_PARTS_LENGTH_OVERLAY_PAD = "80px";

export function clipSelectorTranscriptProps(
  rangeWords: WordCue[],
  collageRegions: CollageRegion[],
  disabledCollageRegionIds: string[],
  onToggleCollageRegion: (regionId: string) => void,
  onSeekToTranscriptTime?: (clipIndex: number, sourceTimeSec: number) => void,
  editProps?: {
    onEditClipTranscript?: (clipIndex: number, op: ClipTranscriptEditOp) => void;
    onUndoClipEdit?: () => void;
    onRedoClipEdit?: () => void;
    canUndoClipEdit?: boolean;
    canRedoClipEdit?: boolean;
    lastEditedTranscriptRange?: { clipIndex: number; startIdx: number; endIdx: number } | null;
  },
) {
  return {
    rangeWords,
    collageRegions,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    onSeekToTranscriptTime,
    ...editProps,
  };
}
