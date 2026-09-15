import React from "react";
import { Box, HStack } from "@chakra-ui/react";
import { ExternalLink, ListOrdered } from "lucide-react";
import {
  OutlinedActionButton,
  getOutlinedActionSurfaceProps,
} from "../../../../shared/components/buttons/outlined-action-button.component";
import { ClipperClipsSection } from "../clipper-clips-section.component";
import { SIDE_PANEL_TAB_OPTIONS, TOOLBAR_ACTION_BUTTON_PROPS } from "./clipper-preview.constants";
import type { ClipperPreviewSidePanelProps } from "./clipper-preview.types";
import { activeClipPreviewsForMode } from "../../hooks/clipper-pipeline/clip-preview.util";

export function ClipperPreviewSidePanel({
  theme,
  projectId,
  clipPreviews,
  safeAutoPartsPreviews,
  safeAiPreviews,
  safeManualPreviews,
  clipSourceMode,
  activeClipIndex,
  onSelectClip,
  onDeleteAiClip,
  onDeleteAutoPartsClip,
  onDeleteManualClip,
  onUpsertManualClip,
  state,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  seekToTranscriptTime,
  pausePreview,
  getRangeFrameContext,
  autoPartsSegmentLengthSec,
  onAutoPartsSegmentLengthChange,
  onResetAutoParts,
  autoPartsResegmenting,
  isRendering = false,
  onOpenRenderQueue,
  onClipSourceModeChange,
  onOpenInStudio,
  openingInStudio = false,
}: ClipperPreviewSidePanelProps) {
  const listPreviews = activeClipPreviewsForMode(
    clipSourceMode,
    safeAutoPartsPreviews,
    safeAiPreviews,
    safeManualPreviews,
  );
  const canOpenInStudio =
    Boolean(onOpenInStudio) && listPreviews.length > 0 && !openingInStudio;

  const handleOpenInStudio = () => {
    if (!onOpenInStudio || listPreviews.length === 0 || openingInStudio) return;
    const active = listPreviews.find((p) => p.clip.index === activeClipIndex);
    const clipIndex = active?.clip.index ?? listPreviews[0]!.clip.index;
    onOpenInStudio(clipIndex);
  };

  return (
    <Box
      minW={0}
      minH={0}
      w={{ base: "full", lg: "auto" }}
      position={{ base: "relative", lg: "absolute" }}
      top={{ lg: 0 }}
      right={{ lg: 0 }}
      bottom={{ lg: 0 }}
      left={{ lg: "calc(42% + var(--chakra-spacing-12))" }}
      h={{ base: "65vh", lg: "auto" }}
      maxH={{ base: "65vh", lg: "none" }}
      display="flex"
      flexDirection="column"
      overflow="hidden"
      border="1px solid"
      borderColor={theme.border.primary}
      borderRadius="28px"
      bg={theme.background.card}
      boxShadow={theme.shadow.panel}
    >
      <HStack
        flexShrink={0}
        px={4}
        pt={3}
        pb={4}
        justify="space-between"
        gap={4}
        flexWrap="wrap"
        align="center"
      >
        <HStack gap={2} flexShrink={0} flexWrap="wrap" align="center">
          <OutlinedActionButton
            startIcon={<ListOrdered size={16} />}
            onClick={onOpenRenderQueue}
            loading={isRendering}
            loadingText="Rendering…"
            flexShrink={0}
            {...TOOLBAR_ACTION_BUTTON_PROPS}
          >
            Go to render queue
          </OutlinedActionButton>

          {onOpenInStudio ? (
            <OutlinedActionButton
              startIcon={<ExternalLink size={16} />}
              onClick={handleOpenInStudio}
              disabled={!canOpenInStudio}
              loading={openingInStudio}
              loadingText="Opening…"
              title={
                openingInStudio
                  ? "Opening Studio…"
                  : canOpenInStudio
                    ? "Open active clip in GrepCut Studio"
                    : "Select a clip first"
              }
              flexShrink={0}
              {...TOOLBAR_ACTION_BUTTON_PROPS}
            >
              Open in Studio
            </OutlinedActionButton>
          ) : null}
        </HStack>

        <HStack gap={1} flexShrink={0} align="center">
          {SIDE_PANEL_TAB_OPTIONS.map((option) => {
            const isActive = clipSourceMode === option.value;
            return (
              <Box
                key={option.value}
                as="button"
                onClick={() => onClipSourceModeChange(option.value)}
                aria-pressed={isActive}
                {...TOOLBAR_ACTION_BUTTON_PROPS}
                {...getOutlinedActionSurfaceProps(theme, isActive)}
                borderRadius="xl"
                cursor="pointer"
                fontWeight="medium"
                color={isActive ? theme.text.primary : theme.text.muted}
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                px={4}
              >
                {option.label}
              </Box>
            );
          })}
        </HStack>
      </HStack>

      <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
        <ClipperClipsSection
          projectId={projectId}
          clipPreviews={clipPreviews}
          autoPartsClipPreviews={safeAutoPartsPreviews}
          aiClipPreviews={safeAiPreviews}
          manualClipPreviews={safeManualPreviews}
          clipSourceMode={clipSourceMode}
          activeClipIndex={activeClipIndex}
          onSelectClip={onSelectClip}
          onDeleteAiClip={onDeleteAiClip}
          onDeleteAutoPartsClip={onDeleteAutoPartsClip}
          onDeleteManualClip={onDeleteManualClip}
          onUpsertManualClip={onUpsertManualClip}
          onOpenInStudio={onOpenInStudio}
          openingInStudio={openingInStudio}
          rangeWords={state.rangeWords}
          collageRegions={collageRegions}
          disabledCollageRegionIds={disabledCollageRegionIds}
          onToggleCollageRegion={onToggleCollageRegion}
          onSeekToTranscriptTime={seekToTranscriptTime}
          autoPartsSegmentLengthSec={autoPartsSegmentLengthSec}
          onAutoPartsSegmentLengthChange={onAutoPartsSegmentLengthChange}
          onResetAutoParts={onResetAutoParts}
          autoPartsResegmenting={autoPartsResegmenting}
          rangeTrimmedVideoUrl={state.rangeTrimmedVideoUrl}
          rangeDurationSec={state.clipDuration ?? 0}
          getRangeFrameContext={getRangeFrameContext}
          onManualEditorOpen={pausePreview}
        />
      </Box>
    </Box>
  );
}
