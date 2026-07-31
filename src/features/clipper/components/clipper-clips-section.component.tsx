import React from "react";
import { Box } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  ClipperAiMcpEmptyState,
  ClipperAiMcpPanel,
} from "./clipper-ai-mcp-panel.component";
import { ClipperAutoPartsLengthIsland } from "./clipper-auto-parts-length-island.component";
import { ClipperClipSelector } from "./clipper-clip-selector.component";
import { ClipsListScroller } from "./clipper-clips-list-scroller.component";
import {
  AUTO_PARTS_LENGTH_OVERLAY_PAD,
  clipSelectorTranscriptProps,
  type ClipperClipsSectionProps,
} from "./clipper-clips-section.types";

export const ClipperClipsSection: React.FC<ClipperClipsSectionProps> = ({
  projectId,
  clipPreviews,
  autoPartsClipPreviews,
  aiClipPreviews,
  clipSourceMode,
  activeClipIndex,
  onSelectClip,
  onDeleteAiClip,
  onDeleteAutoPartsClip,
  rangeWords,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  onSeekToTranscriptTime,
  autoPartsSegmentLengthSec,
  onAutoPartsSegmentLengthChange,
  onResetAutoParts,
  autoPartsResegmenting = false,
}) => {
  const { leftScrollbarCss } = useClipperUi();
  const isAiMode = clipSourceMode === "ai";
  const safeAutoPartsPreviews = autoPartsClipPreviews ?? [];
  const safeAiPreviews = aiClipPreviews ?? [];
  const safeClipPreviews = clipPreviews ?? safeAutoPartsPreviews;
  const listPreviews = isAiMode ? safeAiPreviews : safeAutoPartsPreviews;
  const transcriptProps = clipSelectorTranscriptProps(
    rangeWords,
    collageRegions,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    onSeekToTranscriptTime,
  );

  // Auto-parts needs clips to render; AI mode always shows the MCP panel (even empty).
  if (!isAiMode && safeAutoPartsPreviews.length === 0) {
    return null;
  }

  return (
    <Box flex="1" minH={0} display="flex" flexDirection="column">
      {isAiMode ? (
        <Box
          flex="1"
          minH={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          {listPreviews.length > 0 ? (
            <ClipsListScroller showBottomFade={false} css={leftScrollbarCss}>
              <ClipperClipSelector
                clipPreviews={listPreviews}
                activeClipIndex={activeClipIndex}
                onSelectClip={onSelectClip}
                onDeleteClip={onDeleteAiClip}
                hideTitle
                {...transcriptProps}
              />
            </ClipsListScroller>
          ) : (
            <ClipperAiMcpEmptyState />
          )}

          <ClipperAiMcpPanel clipCount={listPreviews.length} projectId={projectId} />
        </Box>
      ) : (
        <Box
          position="relative"
          flex="1"
          minH={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          <ClipperClipSelector
            clipPreviews={safeClipPreviews}
            activeClipIndex={activeClipIndex}
            onSelectClip={onSelectClip}
            onDeleteClip={onDeleteAutoPartsClip}
            hideTitle
            bottomInset={AUTO_PARTS_LENGTH_OVERLAY_PAD}
            {...transcriptProps}
          />

          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            zIndex={2}
            pointerEvents="none"
          >
            <ClipperAutoPartsLengthIsland
              value={autoPartsSegmentLengthSec}
              onChange={onAutoPartsSegmentLengthChange}
              onReset={onResetAutoParts}
              disabled={autoPartsResegmenting}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
