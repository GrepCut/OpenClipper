import React, { useMemo } from "react";
import { Box, VStack, useDisclosure } from "@chakra-ui/react";
import {
  deriveCollageAspectEligibility,
  deriveTwoSpeakerRegions,
  filterRegionsWithEligibleAspects,
} from "../../engine/reframe/collage";
import type { ClipperClipSegmentWindow } from "../../engine/segmentation";
import { useClipperPreviewPlayback } from "../../hooks/use-clipper-preview-playback.hook";
import { CLIPPER_FORMAT_DEFS } from "../../shared/formats.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { ClipperSettingsDrawer } from "../clipper-settings-drawer.component";
import { ClipperPreviewFormatsFooter } from "./formats-footer.component";
import { ClipperPreviewHeroSection } from "./hero-section.component";
import { ClipperPreviewSidePanel } from "./side-panel.component";
import type { ClipperPreviewProps } from "./clipper-preview.types";

export type { ClipperPreviewProps } from "./clipper-preview.types";

export const ClipperPreview: React.FC<ClipperPreviewProps> = (props) => {
  const {
    state,
    rangeTrimmedVideoUrl,
    clipPreviews,
    autoPartsClipPreviews,
    aiClipPreviews,
    clipSourceMode,
    activeClipIndex,
    onSelectClip,
    onClipSourceModeChange,
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    onAiChatModelChange,
    onSendAiChatMessage,
    onLoadAiChatHistory,
    onNewAiChat,
    aiCurrentClipsJsonChars,
    onDeleteAiClip,
    onDeleteAutoPartsClip,
    settings,
    onUpdateSettings,
    getFrameContext,
    sourceFileName,
    isRendering = false,
    exportCount = 0,
    onViewExports,
    onOpenRenderQueue,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    autoPartsSegmentLengthSec,
    onAutoPartsSegmentLengthChange,
    onResetAutoParts,
    autoPartsResegmenting,
    onEditClipTranscript,
    onUndoClipEdit,
    onRedoClipEdit,
    canUndoClipEdit,
    canRedoClipEdit,
    lastEditedTranscriptRange,
  } = props;

  const { theme, outlineButton } = useClipperUi();
  const { open: settingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();

  const safeAutoPartsPreviews = autoPartsClipPreviews ?? [];
  const safeAiPreviews = aiClipPreviews ?? [];
  const heroPreviews = clipPreviews.length > 0 ? clipPreviews : safeAutoPartsPreviews;
  const activePreview =
    heroPreviews.find((p) => p.clip.index === activeClipIndex) ?? heroPreviews[0];
  const activeClip = activePreview?.clip;
  const clipStartSec = activeClip?.startSec ?? 0;
  const clipEndSec = activeClip?.endSec ?? 60;
  const clipDuration = activeClip?.durationSec ?? 60;
  const clipSegments: ClipperClipSegmentWindow[] = activeClip?.segments?.length
    ? activeClip.segments
    : [{ startSec: clipStartSec, endSec: clipEndSec }];
  const playbackStart = clipSegments[0]?.startSec ?? clipStartSec;
  const playbackEnd = clipSegments.at(-1)?.endSec ?? clipEndSec;

  /**
   * Preview always renders every platform format, independent of which ones
   * are enabled for render in settings — settings.formats.enabledFormatIds
   * only governs what actually gets exported (see pipeline/stages/render.ts).
   */
  const previewFormats = CLIPPER_FORMAT_DEFS;

  const primaryFormat = useMemo(() => {
    const vertical = previewFormats.find((f) => f.aspectId === "9-16");
    return vertical ?? previewFormats[0];
  }, [previewFormats]);

  const secondaryFormats = useMemo(
    () => previewFormats.filter((f) => f.id !== primaryFormat?.id),
    [previewFormats, primaryFormat?.id],
  );

  const collageRegions = useMemo(
    () => {
      const context = getFrameContext();
      const samples = context?.faceCache?.sortedSamples() ?? [];
      const regions = context?.faceRender?.collageRegions ?? deriveTwoSpeakerRegions(samples);
      const eligibility = context?.faceRender?.collageEligibility
        ?? deriveCollageAspectEligibility(samples, regions, settings.reframe.headroom);
      const enabledAspectIds = CLIPPER_FORMAT_DEFS
        .filter((format) => format.mode === "crop" && settings.formats.enabledFormatIds.includes(format.id))
        .map((format) => format.aspectId);
      return filterRegionsWithEligibleAspects(regions, eligibility, enabledAspectIds);
    },
    // faceSampleRevision is the actual change signal; getFrameContext is a stable closure over the session.
    [state.faceSampleRevision, settings.reframe.headroom, settings.formats.enabledFormatIds],
  );

  const { videoRef, canvasRefs, previewRegionRef, togglePlay, seekToTranscriptTime } =
    useClipperPreviewPlayback({
      rangeTrimmedVideoUrl,
      activeClipIndex,
      clipStartSec,
      clipEndSec,
      clipDuration,
      clipSegments,
      playbackStart,
      playbackEnd,
      previewFormats,
      primaryFormat,
      getFrameContext,
      settings,
      onSelectClip,
    });

  return (
    <VStack align="stretch" gap={3}>
      <Box
        position="fixed"
        width="1px"
        height="1px"
        opacity={0}
        pointerEvents="none"
        left="-9999px"
        aria-hidden
      >
        <video ref={videoRef} src={rangeTrimmedVideoUrl} preload="auto" playsInline />
      </Box>

      <Box
        ref={previewRegionRef}
        w="full"
        position="relative"
        display={{ base: "flex", lg: "block" }}
        flexDirection={{ base: "column" }}
        gap={{ base: 8, lg: 0 }}
      >
        <ClipperPreviewHeroSection
          videoRef={videoRef}
          canvasRefs={canvasRefs}
          primaryFormat={primaryFormat}
          clipSegments={clipSegments}
          clipDuration={clipDuration}
          activeClipIndex={activeClipIndex}
          sourceFileName={sourceFileName}
          theme={theme}
          onTogglePlay={togglePlay}
        />

        <ClipperPreviewSidePanel
          {...props}
          theme={theme}
          safeAutoPartsPreviews={safeAutoPartsPreviews}
          safeAiPreviews={safeAiPreviews}
          collageRegions={collageRegions}
          seekToTranscriptTime={seekToTranscriptTime}
        />
      </Box>

      <ClipperPreviewFormatsFooter
        secondaryFormats={secondaryFormats}
        canvasRefs={canvasRefs}
        exportCount={exportCount}
        isRendering={isRendering}
        onViewExports={onViewExports}
        outlineButton={outlineButton}
      />

      <ClipperSettingsDrawer
        open={settingsOpen}
        onOpenChange={(nextOpen) => (nextOpen ? onSettingsOpen() : onSettingsClose())}
        settings={settings}
        words={activeClip?.words ?? []}
        hasDetectedFaces={state.hasDetectedFaces}
        hasTwoSpeakers={state.hasTwoSpeakers}
        onUpdateSettings={onUpdateSettings}
      />
    </VStack>
  );
};
