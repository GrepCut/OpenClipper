import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Center, Text } from "@chakra-ui/react";
import type { Project } from "../../../services/projects.service";
import { ClipperLayout, type ClipperLayoutStep } from "../components/ClipperLayout";
import { ClipperExportsView } from "../components/ClipperExportsView";
import { ClipperPreview } from "../components/ClipperPreview";
import { ClipperRenderQueue } from "../components/ClipperRenderQueue";
import { ClipperRenderQueueSetup } from "../components/ClipperRenderQueueSetup";
import { ClipperProcessing } from "../components/ClipperProcessing";
import { ClipperProjectLoadingPanel } from "../components/ClipperProjectLoadingPanel";
import { ClipperTrimSelect } from "../components/ClipperTrimSelect";
import { ClipperUpload } from "../components/ClipperUpload";
import { ClipperSocialPublishDialog } from "../components/ClipperYoutubePublishDialog";
import type { ClipperPublishTarget } from "../components/ClipperExportFormatRow";
import { useClipperPipeline } from "../hooks/useClipperPipeline";
import { CLIPPER_FORMAT_DEFS } from "../shared/formats";
import { getSessionExportResults } from "../shared/export-results";
import { resumeStepsForStage } from "../shared/loading-status";
import { useClipperUi } from "../shared/use-clipper-ui";
import type { ClipperFormatResult } from "../shared/state";
import { isClipperActivelyRendering } from "../shared/stages";
import {
  buildRenderQueueSnapshot,
  resolveClipFormatIds,
  sanitizeRenderQueueSelections,
} from "../shared/render-queue-utils";
import { scheduleRenderQueueSave } from "../persistence/render-queue-autosave";
import { openClipperExportsDir } from "../persistence/export-files";
import { useYoutubeStore } from "../../../stores/useYoutubeStore";
import { useSocialStore } from "../../../stores/useSocialStore";
import { youtubeAuthService } from "../../../services/youtubeAuth.service";
import {
  socialAuthService,
  oauthFlowForPlatform,
  type SocialPublishablePlatform,
} from "../../../services/socialAuth.service";
import { logYoutubeDebug } from "../shared/youtube-debug";
import type { ClipperLoadedProject } from "../hooks/useClipperProjectLoader";

interface ClipperSessionViewProps {
  project: Project;
  token: string | null;
  loaded: ClipperLoadedProject | null;
}

type QueuePhase = "setup" | "progress" | "complete";

export function ClipperSessionView({ project, token, loaded }: ClipperSessionViewProps) {
  const { theme, errorPanel } = useClipperUi();
  const [view, setView] = useState<"preview" | "queue" | "exports">("preview");
  const [queuePhase, setQueuePhase] = useState<QueuePhase>("setup");
  const [queuePublishTarget, setQueuePublishTarget] = useState<ClipperFormatResult | null>(null);
  const [queuePublishTargetPlatform, setQueuePublishTargetPlatform] = useState<ClipperPublishTarget>("youtube");
  /** Per-clip render format overrides; clips absent here fall back to the global settings selection. */
  const [clipFormatSelections, setClipFormatSelections] = useState<Record<number, string[]>>({});
  const skipRenderQueueSaveRef = useRef(true);
  const renderQueueHydratedRef = useRef(false);
  const clipsReadyForQueueRef = useRef(false);
  const pipeline = useClipperPipeline({ project, token, loaded });
  const {
    state,
    settings,
    exportCount,
    updateSettings,
    selectFile,
    confirmRange,
    renderExports,
    rerenderFormat,
    refreshExportHistory,
    reset,
    getFrameContext,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    loadAiChatHistory,
    sendAiClipChatMessage,
    startNewAiChat,
    deleteAiClip,
    deleteAutoPartsClip,
    editClipTranscript,
    undoClipEdit,
    redoClipEdit,
    canUndoClipEdit,
    canRedoClipEdit,
    lastEditedTranscriptRange,
    aiCurrentClipsJsonChars,
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    setAiChatModel,
    sourceUrl,
    rangeLocked,
    disabledCollageRegionIds,
    toggleCollageRegion,
  } = pipeline;

  const {
    isConnected: isYoutubeConnected,
    channelTitle: youtubeChannelTitle,
    refreshStatus: refreshYoutubeStatus,
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((s) => s.platforms);
  const refreshSocial = useSocialStore((s) => s.refreshAll);

  const handleFile = useCallback(
    (file: File) => {
      void selectFile(file);
    },
    [selectFile],
  );

  const isPreparing =
    state.stage === "uploading" || state.stage === "transcribing" || state.stage === "analyzing-faces" || state.stage === "analyzing-subjects";

  const isRendering = isClipperActivelyRendering(state.clipPreviews, state.stage);

  const sessionResults = useMemo(
    () => getSessionExportResults(state.clipPreviews),
    [state.clipPreviews],
  );

  const clipIndices = useMemo(
    () => state.clipPreviews.map((preview) => preview.clip.index),
    [state.clipPreviews],
  );

  useEffect(() => {
    renderQueueHydratedRef.current = false;
    clipsReadyForQueueRef.current = false;
    skipRenderQueueSaveRef.current = true;
    setQueuePhase("setup");
  }, [project.id]);

  useEffect(() => {
    if (queuePhase === "progress" && !isRendering && sessionResults.length > 0) {
      setQueuePhase("complete");
    }
  }, [isRendering, queuePhase, sessionResults.length]);

  useEffect(() => {
    if (view === "queue" && isRendering) {
      setQueuePhase("progress");
    }
  }, [isRendering, view]);

  useEffect(() => {
    if (!loaded) return;

    const clipsReady = clipIndices.length > 0;
    const shouldHydrate =
      !renderQueueHydratedRef.current || (!clipsReadyForQueueRef.current && clipsReady);

    if (!shouldHydrate) return;

    skipRenderQueueSaveRef.current = true;
    setClipFormatSelections(
      sanitizeRenderQueueSelections(
        loaded.renderQueueFormats,
        clipsReady ? clipIndices : undefined,
      ),
    );
    renderQueueHydratedRef.current = true;
    if (clipsReady) clipsReadyForQueueRef.current = true;
  }, [clipIndices, loaded, project.id]);

  useEffect(() => {
    if (!loaded || skipRenderQueueSaveRef.current) {
      skipRenderQueueSaveRef.current = false;
      return;
    }
    if (clipIndices.length === 0) return;

    const snapshot = buildRenderQueueSnapshot(
      clipIndices,
      clipFormatSelections,
      settings.formats.enabledFormatIds,
    );
    scheduleRenderQueueSave(project.id, snapshot);
  }, [clipFormatSelections, clipIndices, loaded, project.id, settings.formats.enabledFormatIds]);

  const getClipFormatIds = useCallback(
    (clipIndex: number): string[] =>
      resolveClipFormatIds(clipIndex, clipFormatSelections, settings.formats.enabledFormatIds),
    [clipFormatSelections, settings.formats.enabledFormatIds],
  );

  const toggleClipFormat = useCallback(
    (clipIndex: number, formatId: string) => {
      setClipFormatSelections((prev) => {
        const current = resolveClipFormatIds(
          clipIndex,
          prev,
          settings.formats.enabledFormatIds,
        );
        const next = current.includes(formatId)
          ? current.filter((id) => id !== formatId)
          : [...current, formatId];
        return { ...prev, [clipIndex]: next };
      });
    },
    [settings.formats.enabledFormatIds],
  );

  const setFormatForAllClips = useCallback(
    (formatId: string, enabled: boolean) => {
      setClipFormatSelections((prev) => {
        const next: Record<number, string[]> = { ...prev };
        for (const p of state.clipPreviews) {
          const clipIndex = p.clip.index;
          const current = resolveClipFormatIds(
            clipIndex,
            prev,
            settings.formats.enabledFormatIds,
          );
          next[clipIndex] = enabled
            ? current.includes(formatId)
              ? current
              : [...current, formatId]
            : current.filter((id) => id !== formatId);
        }
        return next;
      });
    },
    [settings.formats.enabledFormatIds, state.clipPreviews],
  );

  const setAllFormatsForClip = useCallback((clipIndex: number, enabled: boolean) => {
    setClipFormatSelections((prev) => ({
      ...prev,
      [clipIndex]: enabled ? CLIPPER_FORMAT_DEFS.map((def) => def.id) : [],
    }));
  }, []);

  const formatIdsByClip = useMemo(
    () =>
      Object.fromEntries(
        state.clipPreviews.map((p) => [p.clip.index, getClipFormatIds(p.clip.index)]),
      ) as Record<number, string[]>,
    [state.clipPreviews, getClipFormatIds],
  );

  const openRenderQueue = useCallback(() => {
    setQueuePhase("setup");
    setView("queue");
  }, []);

  const startQueuedRender = useCallback(() => {
    setQueuePhase("progress");
    setView("queue");
    void renderExports(formatIdsByClip);
  }, [formatIdsByClip, renderExports]);

  const handleOpenExportsFolder = useCallback(() => {
    void openClipperExportsDir(project.id).catch(() => {});
  }, [project.id]);

  const handleRequestConnect = useCallback(
    (platform: SocialPublishablePlatform) => {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const flow = oauthFlowForPlatform(platform);
      if (flow === "youtube") {
        logYoutubeDebug("ClipperSessionView: initiating YouTube connect", {
          returnPath,
          projectId: project.id,
        });
        void youtubeAuthService.redirectToYoutubeConnect(returnPath).catch((error) => {
          console.error(
            "[Clipper/YouTube] ClipperSessionView: redirectToYoutubeConnect failed",
            error,
          );
        });
        return;
      }
      void socialAuthService.redirectToConnect(flow, returnPath);
    },
    [project.id],
  );

  const queuePublishPlatform: SocialPublishablePlatform = useMemo(() => {
    if (!queuePublishTarget) return "youtube";
    return queuePublishTargetPlatform;
  }, [queuePublishTarget, queuePublishTargetPlatform]);

  const queuePublishConnection = useMemo(() => {
    if (queuePublishPlatform === "youtube") {
      return {
        connected: isYoutubeConnected,
        accountLabel: youtubeChannelTitle,
      };
    }
    const state = socialPlatforms[queuePublishPlatform];
    return {
      connected: state?.connected ?? false,
      accountLabel: state?.displayName ?? null,
    };
  }, [
    queuePublishPlatform,
    isYoutubeConnected,
    youtubeChannelTitle,
    socialPlatforms,
  ]);

  useEffect(() => {
    void refreshYoutubeStatus();
    void refreshSocial();
  }, [refreshYoutubeStatus, refreshSocial]);

  const step: ClipperLayoutStep | undefined = (() => {
    switch (state.stage) {
      case "trimming":
        return { current: 1, total: 3, title: "Choose your source range" };
      case "uploading":
      case "transcribing":
      case "analyzing-faces":
      case "analyzing-subjects":
        return { current: 2, total: 3, title: "Transcribing & preparing clips" };
      case "preview":
      case "rendering":
      case "done":
        return view === "exports"
          ? { title: "Your exports" }
          : view === "queue"
            ? {
                current: 3,
                total: 3,
                title:
                  queuePhase === "progress"
                    ? "Rendering…"
                    : queuePhase === "complete"
                      ? "Render complete"
                      : "Render queue",
              }
            : { current: 3, total: 3, title: "Preview & customize" };
      case "error":
        return { title: "Something went wrong" };
      default:
        return undefined;
    }
  })();

  const hasPreview =
    state.rangeTrimmedVideoUrl != null &&
    (state.autoPartsClipPreviews?.length ?? state.clipPreviews.length) > 0;
  const isRestoringSession =
    loaded?.resumePlan.target === "restoring" &&
    !hasPreview &&
    state.stage !== "error";
  const showUpload = state.stage === "idle" && !isRestoringSession;
  const showRestoreLoader = isRestoringSession;
  const showFreshProcessing = isPreparing && !hasPreview && !isRestoringSession;
  const showLoadingUi = showRestoreLoader || showFreshProcessing;
  const canShowExports = hasPreview && exportCount > 0;
  const showPreview =
    hasPreview &&
    view === "preview" &&
    (state.stage === "preview" || state.stage === "rendering" || state.stage === "done");
  const showQueue =
    hasPreview &&
    view === "queue" &&
    (state.stage === "preview" || state.stage === "rendering" || state.stage === "done");
  const showExports = canShowExports && view === "exports";
  const showQueueSetup = showQueue && queuePhase === "setup";
  const showQueueProgress =
    showQueue && (queuePhase === "progress" || queuePhase === "complete");

  const layoutBackLink =
    showExports || showQueue
      ? {
          label: "Back to preview",
          onClick: () => setView("preview"),
        }
      : undefined;

  const resumeLoadingStatus = useMemo(
    () => resumeStepsForStage(state.stage, state.stageMessage),
    [state.stage, state.stageMessage],
  );

  return (
    <ClipperLayout step={showLoadingUi ? undefined : step} backLink={layoutBackLink}>
      {showUpload && <ClipperUpload onFile={handleFile} />}

      {state.stage === "trimming" && sourceUrl && !rangeLocked && (
        <ClipperTrimSelect
          sourceUrl={sourceUrl}
          sourceDuration={state.sourceDuration ?? 60}
          initialStartSec={state.clipStart > 0 ? state.clipStart : undefined}
          initialEndSec={state.clipEnd ?? state.sourceDuration ?? undefined}
          sourceFileName={state.sourceFileName}
          onConfirm={(start, end) => {
            void confirmRange(start, end);
          }}
          onCancel={reset}
        />
      )}

      {showRestoreLoader && (
        <Center py={12}>
          <ClipperProjectLoadingPanel status={resumeLoadingStatus} />
        </Center>
      )}

      {showFreshProcessing && (
        <Center py={12}>
          <Box maxW="560px" w="full">
            <ClipperProcessing state={state} />
          </Box>
        </Center>
      )}

      {showPreview && (
        <>
          {state.error && (
            <Box
              mb={4}
              p={4}
              borderRadius="xl"
              {...errorPanel}
            >
              <Text color={theme.status.danger} fontSize="sm">
                {state.error}
              </Text>
            </Box>
          )}
          <ClipperPreview
            state={state}
            rangeTrimmedVideoUrl={state.rangeTrimmedVideoUrl!}
            clipPreviews={state.clipPreviews}
            autoPartsClipPreviews={state.autoPartsClipPreviews ?? state.clipPreviews}
            aiClipPreviews={state.aiClipPreviews ?? []}
            clipSourceMode={state.clipSourceMode ?? "auto-parts"}
            activeClipIndex={state.activeClipIndex}
            onSelectClip={setActiveClipIndex}
            onClipSourceModeChange={setClipSourceMode}
            aiChatMessages={aiChatMessages}
            aiChatLoading={aiChatLoading}
            aiChatError={aiChatError}
            aiChatThinking={aiChatThinking}
            aiChatProgressChars={aiChatProgressChars}
            aiChatModel={aiChatModel}
            onAiChatModelChange={setAiChatModel}
            onSendAiChatMessage={(message, preset) => {
              void sendAiClipChatMessage(message, { preset });
            }}
            onLoadAiChatHistory={() => {
              void loadAiChatHistory();
            }}
            onNewAiChat={() => {
              void startNewAiChat();
            }}
            onDeleteAiClip={deleteAiClip}
            onDeleteAutoPartsClip={deleteAutoPartsClip}
            onEditClipTranscript={editClipTranscript}
            onUndoClipEdit={undoClipEdit}
            onRedoClipEdit={redoClipEdit}
            canUndoClipEdit={canUndoClipEdit}
            canRedoClipEdit={canRedoClipEdit}
            lastEditedTranscriptRange={lastEditedTranscriptRange}
            aiCurrentClipsJsonChars={aiCurrentClipsJsonChars}
            settings={settings}
            onUpdateSettings={updateSettings}
            getFrameContext={getFrameContext}
            sourceFileName={state.sourceFileName}
            isRendering={isRendering}
            exportCount={exportCount}
            onViewExports={() => setView("exports")}
            onOpenRenderQueue={openRenderQueue}
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
          />
        </>
      )}

      {showQueueSetup && (
        <ClipperRenderQueueSetup
          clipPreviews={state.clipPreviews}
          rangeTrimmedVideoUrl={state.rangeTrimmedVideoUrl!}
          getClipFormatIds={getClipFormatIds}
          onToggleClipFormat={toggleClipFormat}
          onSetFormatForAll={setFormatForAllClips}
          onSetAllFormatsForClip={setAllFormatsForClip}
          isRendering={isRendering}
          onRender={startQueuedRender}
        />
      )}

      {showQueueProgress && (
        <ClipperRenderQueue
          state={state}
          clipPreviews={state.clipPreviews}
          formatIdsByClip={formatIdsByClip}
          results={sessionResults}
          isRendering={isRendering}
          onOpenFolder={handleOpenExportsFolder}
          onPublish={(result, target) => {
            if (result.isMissing) return;
            setQueuePublishTargetPlatform(target);
            setQueuePublishTarget(result);
          }}
          onRerenderFormat={(formatId, clipIndex) => void rerenderFormat(formatId, clipIndex)}
        />
      )}

      {showExports && (
        <ClipperExportsView
          exportHistory={state.exportHistory}
          sourceFileName={state.sourceFileName}
          projectId={project.id}
          onRefreshHistory={refreshExportHistory}
        />
      )}

      <ClipperSocialPublishDialog
        isOpen={queuePublishTarget != null}
        onClose={() => setQueuePublishTarget(null)}
        projectId={project.id}
        result={queuePublishTarget}
        sourceFileName={state.sourceFileName}
        defaultConnected={queuePublishConnection.connected}
        accountLabel={queuePublishConnection.accountLabel}
        publishPlatform={queuePublishPlatform}
        onRequestConnect={handleRequestConnect}
      />

      {state.stage === "error" && (
        <Box
          p={6}
          borderRadius="2xl"
          {...errorPanel}
        >
          <Text color={theme.status.danger} fontWeight="semibold" mb={2}>
            Something went wrong
          </Text>
          <Text color={theme.text.muted} mb={4}>
            {state.error}
          </Text>
          <ClipperUpload onFile={handleFile} />
        </Box>
      )}
    </ClipperLayout>
  );
}
