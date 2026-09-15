import React, { Suspense, lazy } from "react";
import { Box } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  ClipperAiMcpEmptyState,
  ClipperAiMcpPanel,
} from "./clipper-ai-mcp-panel.component";
import { ClipperAutoPartsLengthIsland } from "./clipper-auto-parts-length-island.component";
import { ClipperClipSelector } from "./clipper-clip-selector.component";
import {
  AUTO_PARTS_LENGTH_OVERLAY_PAD,
  clipSelectorTranscriptProps,
  type ClipperClipsSectionProps,
} from "./clipper-clips-section.types";

const ClipperManualClipsSection = lazy(async () => {
  const mod = await import("./clipper-manual-clips-section.component");
  return { default: mod.ClipperManualClipsSection };
});

export const ClipperClipsSection: React.FC<ClipperClipsSectionProps> = ({
  projectId,
  clipPreviews,
  autoPartsClipPreviews,
  aiClipPreviews,
  manualClipPreviews,
  clipSourceMode,
  activeClipIndex,
  onSelectClip,
  onDeleteAiClip,
  onDeleteAutoPartsClip,
  onDeleteManualClip,
  onUpsertManualClip,
  onOpenInStudio,
  openingInStudio = false,
  rangeWords,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  onSeekToTranscriptTime,
  autoPartsSegmentLengthSec,
  onAutoPartsSegmentLengthChange,
  onResetAutoParts,
  autoPartsResegmenting = false,
  rangeTrimmedVideoUrl,
  rangeDurationSec,
  getRangeFrameContext,
  onManualEditorOpen,
}) => {
  const { theme } = useClipperUi();
  const isAiMode = clipSourceMode === "ai";
  const isManualMode = clipSourceMode === "manual";
  const safeAutoPartsPreviews = autoPartsClipPreviews ?? [];
  const safeAiPreviews = aiClipPreviews ?? [];
  const safeManualPreviews = manualClipPreviews ?? [];
  const safeClipPreviews = clipPreviews ?? safeAutoPartsPreviews;
  const listPreviews = isAiMode
    ? safeAiPreviews
    : isManualMode
      ? safeManualPreviews
      : safeAutoPartsPreviews;
  const transcriptProps = clipSelectorTranscriptProps(
    rangeWords,
    collageRegions,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    onSeekToTranscriptTime,
  );

  if (!isAiMode && !isManualMode && safeAutoPartsPreviews.length === 0) {
    return null;
  }

  if (isManualMode) {
    return (
      <Suspense
        fallback={
          <Box flex="1" minH={0} display="flex" alignItems="center" justifyContent="center">
            <Box fontSize="sm" color={theme.text.muted}>Loading manual clips…</Box>
          </Box>
        }
      >
        <ClipperManualClipsSection
          clipPreviews={safeManualPreviews}
          activeClipIndex={activeClipIndex}
          onSelectClip={onSelectClip}
          onDeleteManualClip={onDeleteManualClip}
          onUpsertManualClip={onUpsertManualClip}
          onOpenInStudio={onOpenInStudio}
          openingInStudio={openingInStudio}
          rangeWords={rangeWords}
          collageRegions={collageRegions}
          disabledCollageRegionIds={disabledCollageRegionIds}
          onToggleCollageRegion={onToggleCollageRegion}
          onSeekToTranscriptTime={onSeekToTranscriptTime}
          rangeTrimmedVideoUrl={rangeTrimmedVideoUrl}
          rangeDurationSec={rangeDurationSec}
          getRangeFrameContext={getRangeFrameContext}
          onManualEditorOpen={onManualEditorOpen}
        />
      </Suspense>
    );
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
            <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
              <ClipperClipSelector
                clipPreviews={listPreviews}
                activeClipIndex={activeClipIndex}
                onSelectClip={onSelectClip}
                onDeleteClip={onDeleteAiClip}
                onOpenInStudio={onOpenInStudio}
                openingInStudio={openingInStudio}
                hideTitle
                {...transcriptProps}
              />
            </Box>
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
            onOpenInStudio={onOpenInStudio}
            openingInStudio={openingInStudio}
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
