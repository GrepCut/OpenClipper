import React from "react";
import { Box, Text } from "@chakra-ui/react";
import { ClipperPreview } from "../preview/clipper-preview.component";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import type { useClipperSessionView } from "../../hooks/use-clipper-session-view.hook";

type SessionView = ReturnType<typeof useClipperSessionView>;

export interface ClipperSessionPreviewPanelProps {
  session: SessionView;
  settingsDrawerVisible?: boolean;
}

export const ClipperSessionPreviewPanel: React.FC<ClipperSessionPreviewPanelProps> = ({
  session,
  settingsDrawerVisible = true,
}) => {
  const { theme, errorPanel } = useClipperUi();
  const {
    project,
    state,
    settings,
    updateSettings,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    deleteAiClip,
    deleteAutoPartsClip,
    disabledCollageRegionIds,
    toggleCollageRegion,
    isRendering,
    renderQueue,
  } = session;

  return (
    <>
      {state.error && (
        <Box mb={4} p={4} borderRadius="xl" {...errorPanel}>
          <Text color={theme.status.danger} fontSize="sm">
            {state.error}
          </Text>
        </Box>
      )}
      <ClipperPreview
        projectId={project.id}
        state={state}
        rangeTrimmedVideoUrl={state.rangeTrimmedVideoUrl}
        clipPreviews={state.clipPreviews}
        autoPartsClipPreviews={state.autoPartsClipPreviews ?? state.clipPreviews}
        aiClipPreviews={state.aiClipPreviews ?? []}
        clipSourceMode={state.clipSourceMode ?? "auto-parts"}
        activeClipIndex={state.activeClipIndex}
        onSelectClip={setActiveClipIndex}
        onClipSourceModeChange={setClipSourceMode}
        onDeleteAiClip={deleteAiClip}
        onDeleteAutoPartsClip={deleteAutoPartsClip}
        settings={settings}
        onUpdateSettings={updateSettings}
        getFrameContext={getFrameContext}
        sourceFileName={state.sourceFileName}
        isRendering={isRendering}
        onOpenRenderQueue={renderQueue.openRenderQueue}
        disabledCollageRegionIds={disabledCollageRegionIds}
        onToggleCollageRegion={toggleCollageRegion}
        autoPartsSegmentLengthSec={autoPartsSegmentLengthSec}
        onAutoPartsSegmentLengthChange={(lengthSec) => {
          void resegmentAutoParts(lengthSec);
        }}
        onResetAutoParts={() => {
          void resegmentAutoParts(autoPartsSegmentLengthSec, { force: true });
        }}
        autoPartsResegmenting={autoPartsResegmenting}
        settingsDrawerVisible={settingsDrawerVisible}
      />
    </>
  );
};
