import React, { useCallback, useEffect, useState } from "react";
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { FolderOpen, Youtube } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui";
import type { ClipperFormatResult } from "../shared/state";
import { ClipperExportHistoryList } from "./ClipperExportHistoryList";
import { ClipperYoutubePublishDialog } from "./ClipperYoutubePublishDialog";
import { openClipperExportsDir } from "../persistence/export-files";
import { useYoutubeStore } from "../../../stores/useYoutubeStore";
import { youtubeAuthService } from "../../../services/youtubeAuth.service";
import { logYoutubeDebug, logYoutubeError } from "../shared/youtube-debug";

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
  const totalExports = exportHistory.length;
  const {
    isConnected: isYoutubeConnected,
    channelTitle: youtubeChannelTitle,
    isChecking: isYoutubeChecking,
    refreshStatus: refreshYoutubeStatus,
  } = useYoutubeStore();
  const [publishTarget, setPublishTarget] = useState<ClipperFormatResult | null>(null);

  useEffect(() => {
    logYoutubeDebug("ClipperExportsView: refreshing YouTube status on mount");
    void refreshYoutubeStatus();
  }, [refreshYoutubeStatus]);

  useEffect(() => {
    logYoutubeDebug("ClipperExportsView: YouTube store state changed", {
      isYoutubeConnected,
      youtubeChannelTitle,
      isYoutubeChecking,
    });
  }, [isYoutubeConnected, youtubeChannelTitle, isYoutubeChecking]);

  useEffect(() => {
    onRefreshHistory();
  }, [onRefreshHistory]);

  const handleConnectYoutube = useCallback(() => {
    const returnPath = `${window.location.pathname}${window.location.search}`;
    logYoutubeDebug("ClipperExportsView: initiating YouTube connect", { returnPath });
    void youtubeAuthService.redirectToYoutubeConnect(returnPath).catch((error) => {
      logYoutubeError("ClipperExportsView: redirectToYoutubeConnect failed", error);
    });
  }, []);

  const handleOpenFolder = useCallback(() => {
    void openClipperExportsDir(projectId).catch(() => {});
  }, [projectId]);

  return (
    <VStack align="stretch" gap={6}>
      <HStack
        justify="space-between"
        align="center"
        flexWrap="wrap"
        gap={3}
        p={4}
        borderRadius="2xl"
        bg={theme.surface.inset}
        border="1px solid"
        borderColor={theme.surface.hover}
      >
        <HStack gap={3} flexWrap="wrap" flex={1} minW={0}>
          <HStack gap={2} color={theme.text.primary} minW={0}>
            <Box flexShrink={0}>
              <Youtube size={18} color="#FF0000" />
            </Box>
            <Text fontSize="sm">
              {isYoutubeChecking
                ? "Checking YouTube…"
                : isYoutubeConnected
                  ? youtubeChannelTitle
                    ? `YouTube: ${youtubeChannelTitle}`
                    : "YouTube connected"
                  : "Connect YouTube to publish clips directly"}
            </Text>
          </HStack>
          <Button
            size="sm"
            variant="outline"
            borderRadius="xl"
            loading={isYoutubeChecking}
            onClick={() => {
              if (isYoutubeConnected) {
                logYoutubeDebug("ClipperExportsView: manual YouTube status refresh");
                void refreshYoutubeStatus();
              } else {
                handleConnectYoutube();
              }
            }}
            {...outlineButton}
          >
            {isYoutubeConnected ? "Refresh status" : "Connect YouTube"}
          </Button>
        </HStack>

        <Button
          variant="outline"
          borderRadius="xl"
          flexShrink={0}
          onClick={handleOpenFolder}
          {...outlineButton}
        >
          <HStack gap={2}>
            <FolderOpen size={16} />
            <span>Open exports folder</span>
          </HStack>
        </Button>
      </HStack>

      <Box>
        <Text fontSize="2xl" fontWeight="bold" color={theme.text.primary} mb={2}>
          Your exports
        </Text>
        <Text color={theme.text.muted}>
          {sourceFileName
            ? `${totalExports} file${totalExports !== 1 ? "s" : ""} from ${sourceFileName} — saved to your project exports folder.`
            : "Rendered files are saved to your project exports folder."}
        </Text>
      </Box>

      <ClipperExportHistoryList
        exports={exportHistory}
        onOpenFolder={handleOpenFolder}
        onPublish={(result) => {
          if (result.isMissing) return;
          setPublishTarget(result);
        }}
      />

      <ClipperYoutubePublishDialog
        isOpen={publishTarget != null}
        onClose={() => setPublishTarget(null)}
        projectId={projectId}
        result={publishTarget}
        sourceFileName={sourceFileName}
        defaultConnected={isYoutubeConnected}
        channelTitle={youtubeChannelTitle}
        onRequestConnect={handleConnectYoutube}
      />
    </VStack>
  );
};
