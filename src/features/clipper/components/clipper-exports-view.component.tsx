import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { FolderOpen } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";
import { ClipperExportHistoryList } from "./clipper-export-history-list.component";
import type { ClipperPublishTarget } from "./clipper-export-format-row.component";
import { ClipperSocialPublishDialog } from "./clipper-youtube-publish-dialog.component";
import { openClipperExportsDir } from "../persistence/export-files.util";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import {
  socialAuthService,
  oauthFlowForPlatform,
  type SocialPublishablePlatform,
} from "../../../services/social-auth.service";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { useLocation, useNavigate } from "react-router-dom";
import { rememberAuthReturnPath } from "../../../shared/auth/auth-return-path.util";
import { appToast } from "../../../shared/utils/toast.service";

interface ClipperExportsViewProps {
  exportHistory: ClipperFormatResult[];
  sourceFileName: string | null;
  projectId: string;
  onRefreshHistory: () => void;
}

export const ClipperExportsView: React.FC<ClipperExportsViewProps> = ({
  exportHistory,
  sourceFileName,
  projectId,
  onRefreshHistory,
}) => {
  const { theme, outlineButton } = useClipperUi();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, isAuthenticated, sessionMode } = useAuth();
  const canUseAccountFeatures = Boolean(
    user && token && isAuthenticated && sessionMode === "online",
  );
  const totalExports = exportHistory.length;
  const {
    isConnected: isYoutubeConnected,
    channelTitle: youtubeChannelTitle,
    refreshStatus: refreshYoutubeStatus,
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((s) => s.platforms);
  const refreshSocial = useSocialStore((s) => s.refreshAll);
  const [publishTarget, setPublishTarget] = useState<ClipperFormatResult | null>(
    null,
  );
  const [publishTargetPlatform, setPublishTargetPlatform] =
    useState<ClipperPublishTarget>("youtube");

  useEffect(() => {
    if (!canUseAccountFeatures) return;
    void refreshYoutubeStatus();
    void refreshSocial();
  }, [canUseAccountFeatures, refreshYoutubeStatus, refreshSocial]);

  useEffect(() => {
    onRefreshHistory();
  }, [onRefreshHistory]);

  const publishPlatform: SocialPublishablePlatform = useMemo(() => {
    if (!publishTarget) return "youtube";
    return publishTargetPlatform;
  }, [publishTarget, publishTargetPlatform]);

  const { connected, accountLabel } = useMemo(() => {
    if (publishPlatform === "youtube") {
      return {
        connected: isYoutubeConnected,
        accountLabel: youtubeChannelTitle,
      };
    }
    const state = socialPlatforms[publishPlatform];
    return {
      connected: state?.connected ?? false,
      accountLabel: state?.displayName ?? null,
    };
  }, [
    publishPlatform,
    isYoutubeConnected,
    youtubeChannelTitle,
    socialPlatforms,
  ]);

  const handleOpenFolder = useCallback(async () => {
    await openClipperExportsDir(projectId);
  }, [projectId]);

  const handleRequestConnect = useCallback(
    (platform: SocialPublishablePlatform) => {
      if (!canUseAccountFeatures) return;
      const flow = oauthFlowForPlatform(platform);
      const returnPath = `/clipper/${projectId}?tab=exports`;
      if (flow === "youtube") {
        void youtubeAuthService.redirectToYoutubeConnect(returnPath);
        return;
      }
      void socialAuthService.redirectToConnect(flow, returnPath);
    },
    [canUseAccountFeatures, projectId],
  );

  const requestAccount = useCallback(() => {
    if (user && isAuthenticated) {
      appToast.error("Account offline", "Connect to the internet to publish clips.");
      return;
    }
    rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
    navigate("/auth");
  }, [isAuthenticated, location.hash, location.pathname, location.search, navigate, user]);

  return (
    <VStack align="stretch" gap={6}>
      <Box>
        <HStack justify="space-between" mb={2} flexWrap="wrap" gap={3}>
          <Text fontSize="lg" fontWeight="semibold" color={theme.text.primary}>
            Exports
          </Text>
          <Button
            size="sm"
            borderRadius="xl"
            {...outlineButton}
            onClick={() => void handleOpenFolder()}
          >
            <HStack gap={2}>
              <FolderOpen size={16} />
              <Text>Open folder</Text>
            </HStack>
          </Button>
        </HStack>
        <Text color={theme.text.muted}>
          {sourceFileName
            ? `${totalExports} file${totalExports !== 1 ? "s" : ""} from ${sourceFileName} — saved to your project exports folder.`
            : "Rendered files are saved to your project exports folder."}
        </Text>
      </Box>

      <ClipperExportHistoryList
        exports={exportHistory}
        onOpenFolder={handleOpenFolder}
        onPublish={(result, target) => {
          if (result.isMissing) return;
          if (!canUseAccountFeatures) {
            requestAccount();
            return;
          }
          setPublishTargetPlatform(target);
          setPublishTarget(result);
        }}
      />

      <ClipperSocialPublishDialog
        isOpen={publishTarget != null}
        onClose={() => setPublishTarget(null)}
        projectId={projectId}
        result={publishTarget}
        sourceFileName={sourceFileName}
        defaultConnected={connected}
        accountLabel={accountLabel}
        publishPlatform={publishPlatform}
        onRequestConnect={handleRequestConnect}
      />
    </VStack>
  );
};
