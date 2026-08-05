import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, VStack } from "@chakra-ui/react";
import { deriveRegionsFromLayoutTracks } from "../../engine/reframe/collage";
import type { ClipperClipSegmentWindow } from "../../engine/segmentation";
import { useClipperPreviewPlayback } from "../../hooks/use-clipper-preview-playback.hook";
import { CLIPPER_TRIMMED_SEGMENT_FILE } from "../../platform/native-source.util";
import {
  buildClipperStudioImportV1,
  openClipInStudio,
  type OpenInStudioProgress,
} from "../../lib/studio-import/build-studio-import.util";
import { readClipperSmartCropAnalysis } from "../../persistence/project-data-files.util";
import { CLIPPER_FORMAT_DEFS } from "../../shared/formats.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { appToast } from "../../../../shared/utils/toast.service";
import type { ClipperFrameContext } from "../../engine/types/render.types";
import { ClipperSettingsDrawer, type ClipperSettingsDrawerPanel } from "../clipper-settings-drawer.component";
import { ClipperPreviewFormatsFooter } from "./formats-footer.component";
import { ClipperPreviewHeroSection } from "./hero-section.component";
import { OpenInStudioProgressModal } from "./open-in-studio-progress-modal.component";
import { ClipperPreviewSidePanel } from "./side-panel.component";
import type { SidePanelTab } from "./clipper-preview.constants";
import type { ClipperPreviewProps } from "./clipper-preview.types";

export type { ClipperPreviewProps } from "./clipper-preview.types";

export const ClipperPreview: React.FC<ClipperPreviewProps> = (props) => {
  const {
    projectId,
    state,
    rangeTrimmedVideoUrl,
    clipPreviews,
    autoPartsClipPreviews,
    aiClipPreviews,
    clipSourceMode,
    activeClipIndex,
    onSelectClip,
    onClipSourceModeChange,
    onDeleteAiClip,
    onDeleteAutoPartsClip,
    settings,
    onUpdateSettings,
    getFrameContext,
    sourceFileName,
    onOpenRenderQueue,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    autoPartsSegmentLengthSec,
    onAutoPartsSegmentLengthChange,
    onResetAutoParts,
    autoPartsResegmenting,
    settingsDrawerVisible = true,
    onOpenInStudio: onOpenInStudioProp,
  } = props;

  const { theme } = useClipperUi();
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<ClipperSettingsDrawerPanel | null>(null);
  const [openingInStudio, setOpeningInStudio] = useState(false);
  const [studioOpenProgress, setStudioOpenProgress] = useState<OpenInStudioProgress | null>(null);
  const openingInStudioRef = useRef(false);

  useEffect(() => {
    if (!settingsDrawerVisible) {
      setActiveSettingsPanel(null);
    }
  }, [settingsDrawerVisible]);
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>(
    clipSourceMode === "ai" ? "ai" : "auto-parts",
  );

  const handleSidePanelTabChange = useCallback((tab: SidePanelTab) => {
    if (tab === "ai") {
      onClipSourceModeChange("ai");
      setSidePanelTab("ai");
      return;
    }
    onClipSourceModeChange("auto-parts");
    setSidePanelTab("auto-parts");
  }, [onClipSourceModeChange]);

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

  const previewFormats = CLIPPER_FORMAT_DEFS;

  const primaryFormat = useMemo(() => {
    const vertical = previewFormats.find((f) => f.aspectId === "9-16");
    return vertical ?? previewFormats[0];
  }, [previewFormats]);

  const handleOpenInStudio = useCallback(
    (clipIndex: number) => {
      if (openingInStudioRef.current) return;
      void (async () => {
        let started = false;
        try {
          if (onOpenInStudioProp) {
            onOpenInStudioProp(clipIndex);
            return;
          }

          const fromAi = safeAiPreviews.find((p) => p.clip.index === clipIndex);
          const fromAuto = safeAutoPartsPreviews.find(
            (p) => p.clip.index === clipIndex,
          );
          const fromHero = clipPreviews.find((p) => p.clip.index === clipIndex);
          const preview = fromAi ?? fromAuto ?? fromHero;
          if (!preview) {
            appToast.error(
              "No clip found",
              `Could not find clip #${clipIndex + 1} to open in Studio.`,
            );
            return;
          }

          openingInStudioRef.current = true;
          started = true;
          setOpeningInStudio(true);
          setStudioOpenProgress({ phase: "preparing", ratio: 0 });

          const contextForClip = getFrameContext(clipIndex);
          let analysis = contextForClip?.smartCropAnalysis ?? null;

          if (!analysis && projectId) {
            try {
              const fromDisk = await readClipperSmartCropAnalysis(projectId);
              if (fromDisk) {
                analysis = fromDisk;
              }
            } catch {
            }
          }

          const frameContext: ClipperFrameContext | null = contextForClip
            ? { ...contextForClip, smartCropAnalysis: analysis }
            : null;

          const videoHint = CLIPPER_TRIMMED_SEGMENT_FILE;
          const manifest = buildClipperStudioImportV1({
            clip: preview.clip,
            settings,
            frameContext,
            sourceVideoFileName: videoHint,
            preferredFormatId: primaryFormat?.id,
          });
          if (manifest.cropTrack.length === 0) {
            appToast.warning(
              "No AutoFlip crop track",
              "Subject analysis has no reframing samples — Studio will import without zoom keyframes.",
            );
          }
          await openClipInStudio(manifest, {
            projectId,
            onProgress: setStudioOpenProgress,
          });
        } catch {
        } finally {
          if (started) {
            openingInStudioRef.current = false;
            setOpeningInStudio(false);
            setStudioOpenProgress(null);
          }
        }
      })();
    },
    [
      onOpenInStudioProp,
      projectId,
      safeAiPreviews,
      safeAutoPartsPreviews,
      clipPreviews,
      getFrameContext,
      settings,
      primaryFormat?.id,
    ],
  );

  const secondaryFormats = useMemo(
    () => previewFormats.filter((f) => f.id !== primaryFormat?.id),
    [previewFormats, primaryFormat?.id],
  );

  const smartCropAnalysis = getFrameContext()?.smartCropAnalysis ?? null;
  const collageRegions = useMemo(
    () => deriveRegionsFromLayoutTracks(smartCropAnalysis),
    [smartCropAnalysis],
  );

  const { videoRef, registerCanvas, previewRegionRef, togglePlay, seekToTranscriptTime } =
    useClipperPreviewPlayback({
      rangeTrimmedVideoUrl,
      previewActive: settingsDrawerVisible,
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
    <VStack align="stretch" gap={4}>
      <Box
        position="fixed"
        width="1px"
        height="1px"
        opacity={0}
        pointerEvents="none"
        left="-9999px"
        aria-hidden
      >
        <video
          ref={videoRef}
          preload="metadata"
          playsInline
        />
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
          registerCanvas={registerCanvas}
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
          onOpenInStudio={handleOpenInStudio}
          openingInStudio={openingInStudio}
        />
      </Box>

      <ClipperPreviewFormatsFooter
        secondaryFormats={secondaryFormats}
        registerCanvas={registerCanvas}
      />

      <OpenInStudioProgressModal
        isOpen={openingInStudio}
        progress={studioOpenProgress}
      />

      <ClipperSettingsDrawer
        activePanel={activeSettingsPanel}
        onActivePanelChange={setActiveSettingsPanel}
        settings={settings}
        words={activeClip?.words ?? []}
        onUpdateSettings={onUpdateSettings}
        visible={settingsDrawerVisible}
      />
    </VStack>
  );
};
