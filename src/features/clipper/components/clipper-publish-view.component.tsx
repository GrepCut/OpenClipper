import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Center, Text, VStack } from "@chakra-ui/react";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { useTheme } from "../../../theme";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { rememberAuthReturnPath } from "../../../shared/auth/auth-return-path.util";
import { appToast } from "../../../shared/utils/toast.service";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import {
  oauthFlowForPlatform,
  publishPlatformForFormat,
  socialAuthService,
  type SocialPublishablePlatform,
} from "../../../services/social-auth.service";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import type { ExportSocialFields } from "../persistence/clipper-export-social.util";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { useClipperPublishMap } from "../hooks/use-clipper-publish-map.hook";
import { resolveExportMapItemMedia } from "../shared/clipper-publish-graph.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { ClipperPublishGraph } from "./clipper-publish-graph.component";
import { ClipperPublishDetailPanel } from "./clipper-publish-detail-panel.component";
import { ClipperPublishProjectPanel } from "./clipper-publish-project-panel.component";
import { ClipperPublishOwnerPanel } from "./clipper-publish-owner-panel.component";
import { ClipperPublishSplitLayout } from "./clipper-publish-split-layout.component";
import { ClipperSocialPublishDialog } from "./clipper-youtube-publish-dialog.component";

export function ClipperPublishView() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, isAuthenticated, sessionMode } = useAuth();
  const canUseAccountFeatures = Boolean(
    user && token && isAuthenticated && sessionMode === "online",
  );

  const {
    items,
    graphData,
    loading,
    mediaLoading,
    selection,
    selectedExportId,
    selectedProjectId,
    selectedOwnerId,
    selectedItem,
    selectedProject,
    selectedResult,
    selectNode,
    refresh,
    updateItemPublishStatus,
  } = useClipperPublishMap();

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishItem, setPublishItem] = useState<ClipperExportMapItem | null>(null);
  const [publishResult, setPublishResult] = useState<ClipperFormatResult | null>(null);
  const [publishLoadingExportId, setPublishLoadingExportId] = useState<string | null>(null);

  const {
    connections: youtubeConnections,
    isConnected: isYoutubeConnected,
    refreshStatus: refreshYoutubeStatus,
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((s) => s.platforms);
  const refreshSocial = useSocialStore((s) => s.refreshAll);

  useEffect(() => {
    if (!canUseAccountFeatures) return;
    void refreshYoutubeStatus();
    void refreshSocial();
  }, [canUseAccountFeatures, refreshYoutubeStatus, refreshSocial]);

  const publishPlatform: SocialPublishablePlatform = useMemo(() => {
    if (!publishItem) return "youtube";
    const formatPlatform = publishItem.platform === "twitter" ? "twitter" : publishItem.platform;
    return publishPlatformForFormat(formatPlatform) ?? "youtube";
  }, [publishItem]);

  const { connected, accountLabel, accountConnections } = useMemo(() => {
    if (publishPlatform === "youtube") {
      return {
        connected: isYoutubeConnected,
        accountLabel: youtubeConnections[0]?.displayName ?? null,
        accountConnections: youtubeConnections,
      };
    }
    const state = socialPlatforms[publishPlatform];
    return {
      connected: state?.connected ?? false,
      accountLabel: state?.displayName ?? null,
      accountConnections: state?.connections ?? [],
    };
  }, [publishPlatform, isYoutubeConnected, youtubeConnections, socialPlatforms]);

  const requestAccount = useCallback(() => {
    if (user && isAuthenticated) {
      appToast.error("Account offline", "Connect to the internet to publish clips.");
      return;
    }
    rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
    navigate("/auth");
  }, [isAuthenticated, location.hash, location.pathname, location.search, navigate, user]);

  const handleRequestConnect = useCallback(
    (platform: SocialPublishablePlatform) => {
      if (!canUseAccountFeatures) return;
      const flow = oauthFlowForPlatform(platform);
      const returnPath = `${location.pathname}?tab=publish`;
      if (flow === "youtube") {
        void youtubeAuthService.redirectToYoutubeConnect(returnPath);
        return;
      }
      void socialAuthService.redirectToConnect(flow, returnPath);
    },
    [canUseAccountFeatures, location.pathname],
  );

  const handlePublishExport = useCallback(
    async (item: ClipperExportMapItem) => {
      if (!item.clipperOwnerId) {
        appToast.error("Owner required", "Assign an owner to this project before publishing.");
        return;
      }
      if (!canUseAccountFeatures) {
        requestAccount();
        return;
      }

      setPublishLoadingExportId(item.id);
      try {
        const result = await resolveExportMapItemMedia(item);
        if (result.isMissing) {
          appToast.error("Export missing", "The export file was not found on disk.");
          return;
        }
        setPublishItem(item);
        setPublishResult(result);
        setPublishOpen(true);
      } finally {
        setPublishLoadingExportId(null);
      }
    },
    [canUseAccountFeatures, requestAccount],
  );

  const handlePublishDialogClose = useCallback(() => {
    setPublishOpen(false);
    setPublishItem(null);
    setPublishResult(null);
    void refresh();
  }, [refresh]);

  const handleMetadataSaved = useCallback(
    (_exportId: string, _fields: ExportSocialFields) => {
      void refresh();
    },
    [refresh],
  );

  const handleExportDeleted = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  return (
    <VStack align="stretch" gap={6} flex="1" minH={0}>
      <SecondaryMainTitle
        fontSize={{ base: "2xl", md: "3xl" }}
        fontWeight="bold"
        color={theme.text.primary}
      >
        Publish map
      </SecondaryMainTitle>

      {loading ? (
        <Center py={16} flex="1">
          <AppLoader />
        </Center>
      ) : items.length === 0 ? (
        <Box
          p={10}
          borderRadius="2xl"
          border="1px dashed"
          borderColor={theme.dashboard.border}
          textAlign="center"
          bg={theme.background.card}
        >
          <Text color={theme.text.primary} fontWeight="semibold" mb={2}>
            No exports yet
          </Text>
          <Text color={theme.text.muted}>
            Export clips from a project session to see them on the publish map.
          </Text>
        </Box>
      ) : (
        <ClipperPublishSplitLayout
          graph={
            <ClipperPublishGraph
              graphData={graphData}
              items={items}
              selectedExportId={selectedExportId}
              selectedProjectId={selectedProjectId}
              selectedOwnerId={selectedOwnerId}
              onNodeClick={selectNode}
              connectedSplit
            />
          }
          detail={
            selection.kind === "export" ? (
              <ClipperPublishDetailPanel
                item={selectedItem}
                result={selectedResult}
                mediaLoading={mediaLoading}
                onMetadataSaved={handleMetadataSaved}
                onDeleted={handleExportDeleted}
                connectedSplit
              />
            ) : selection.kind === "owner" ? (
              <ClipperPublishOwnerPanel
                ownerId={selectedOwnerId}
                connectedSplit
              />
            ) : (
              <ClipperPublishProjectPanel
                project={selectedProject}
                canPublish={canUseAccountFeatures}
                publishLoadingExportId={publishLoadingExportId}
                onPublishExport={(item) => void handlePublishExport(item)}
                connectedSplit
              />
            )
          }
        />
      )}

      <ClipperSocialPublishDialog
        isOpen={publishOpen}
        onClose={handlePublishDialogClose}
        projectId={publishItem?.projectId ?? ""}
        result={publishResult}
        sourceFileName={publishItem?.projectName ?? null}
        defaultConnected={connected}
        accountLabel={accountLabel}
        accountConnections={accountConnections}
        publishPlatform={publishPlatform}
        onRequestConnect={handleRequestConnect}
        onPublishComplete={(record) => {
          if (!publishItem) return;
          updateItemPublishStatus(publishItem.id, record);
        }}
      />
    </VStack>
  );
}
