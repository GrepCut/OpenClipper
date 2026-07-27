import React, { useCallback, useMemo, useState } from "react";
import { Box, VStack, useDisclosure } from "@chakra-ui/react";
import { deriveRegionsFromLayoutTracks } from "../../engine/reframe/collage";
import type { ClipperClipSegmentWindow } from "../../engine/segmentation";
import { useClipperPreviewPlayback } from "../../hooks/use-clipper-preview-playback.hook";
import { CLIPPER_FORMAT_DEFS } from "../../shared/formats.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { ClipperSettingsDrawer } from "../clipper-settings-drawer.component";
import { ClipperPreviewFormatsFooter } from "./formats-footer.component";
import { ClipperPreviewHeroSection } from "./hero-section.component";
import { ClipperPreviewSidePanel } from "./side-panel.component";
import type { SidePanelTab } from "./clipper-preview.constants";
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
    onOpenRenderQueue,
    guardAccount,
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

  const { theme } = useClipperUi();
  const { open: settingsOpen, onOpen: onSettingsOpen, onClose: onSettingsClose } = useDisclosure();
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>(
    clipSourceMode === "ai" ? "ai" : "auto-parts",
  );

  const handleSidePanelTabChange = useCallback((tab: SidePanelTab) => {
    if (tab === "ai") {
      if (guardAccount && !guardAccount()) return;
      onClipSourceModeChange("ai");
      setSidePanelTab("ai");
      return;
    }
    onClipSourceModeChange("auto-parts");
    setSidePanelTab("auto-parts");
  }, [guardAccount, onClipSourceModeChange]);

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

  const smartCropAnalysis = getFrameContext()?.smartCropAnalysis ?? null;
  const collageRegions = useMemo(
    () => deriveRegionsFromLayoutTracks(smartCropAnalysis),
    [smartCropAnalysis],
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
          sidePanelTab={sidePanelTab}
          onSidePanelTabChange={handleSidePanelTabChange}
        />
      </Box>

      <ClipperPreviewFormatsFooter
        secondaryFormats={secondaryFormats}
        canvasRefs={canvasRefs}
      />

      <ClipperSettingsDrawer
        open={settingsOpen}
        onOpenChange={(nextOpen) => (nextOpen ? onSettingsOpen() : onSettingsClose())}
        settings={settings}
        words={activeClip?.words ?? []}
        onUpdateSettings={onUpdateSettings}
      />
    </VStack>
  );
};
