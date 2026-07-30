import React, { useCallback, useEffect, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Youtube,
  Instagram,
  Facebook,
} from "lucide-react";
import { colors, useTheme } from "../../../theme";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import { socialAuthService } from "../../../services/social-auth.service";
import type {
  MetaTargetsResponse,
  SocialOAuthFlow,
  SocialPublishablePlatform,
} from "../../../services/types/social-auth.types";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useSocialStore } from "../../../stores/use-social-store.store";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { StyledModal } from "../../../shared/components/styled-modal.component";
import { appToast } from "../../../shared/utils/toast.service";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { useLocation, useNavigate } from "react-router-dom";
import { rememberAuthReturnPath } from "../../../shared/auth/auth-return-path.util";
import { logIntegration } from "../../../shared/utils/integration-logger.util";

const INTEGRATIONS_RETURN_PATH = "/clipper?tab=integrations";

interface IntegrationRowProps {
  name: string;
  icon: React.ReactNode;
  isActive: boolean;
  isChecking: boolean;
  subtitle?: string | null;
  onConnect?: () => void;
  isConnecting?: boolean;
  onDisconnect?: () => void;
  isDisconnecting?: boolean;
}

function IntegrationRow({
  name,
  icon,
  isActive,
  isChecking,
  subtitle,
  onConnect,
  isConnecting = false,
  onDisconnect,
  isDisconnecting = false,
}: IntegrationRowProps) {
  const { theme, mode } = useTheme();
  const rowBg = mode === "dark" ? theme.background.card : "gray.50";

  return (
    <Box bg={rowBg} borderRadius="2xl" p={{ base: 4, md: 5 }}>
      <HStack justify="space-between" align="center" gap={4}>
        <HStack gap={3} minW={0} flex={1}>
          <Box flexShrink={0} color={theme.text.muted}>
            {icon}
          </Box>
          <VStack align="start" gap={0.5} minW={0}>
            <Text fontWeight="semibold" color={theme.text.primary}>
              {name}
            </Text>
            {subtitle ? (
              <Text fontSize="sm" color={theme.text.muted} lineClamp={1}>
                {subtitle}
              </Text>
            ) : null}
          </VStack>
        </HStack>

        {isChecking ? (
          <OutlinedActionButton disabled whiteSpace="nowrap">
            Checking…
          </OutlinedActionButton>
        ) : isActive ? (
          <HStack gap={2} flexShrink={0}>
            <Box
              px={2.5}
              py={0.5}
              borderRadius="full"
              bg={mode === "dark" ? theme.brand.purpleSoftAlpha12 : theme.brand.toggleActiveBg}
              color={colors.purple.medium}
              fontSize="xs"
              fontWeight="semibold"
              whiteSpace="nowrap"
            >
              Active
            </Box>
            {onDisconnect ? (
              <OutlinedActionButton
                tone="danger"
                loading={isDisconnecting}
                onClick={onDisconnect}
                whiteSpace="nowrap"
              >
                Disconnect
              </OutlinedActionButton>
            ) : null}
          </HStack>
        ) : onConnect ? (
          <OutlinedActionButton
            loading={isConnecting}
            onClick={onConnect}
            whiteSpace="nowrap"
          >
            Connect {name}
          </OutlinedActionButton>
        ) : null}
      </HStack>
    </Box>
  );
}

function TikTokIcon() {
  return (
    <Text as="span" fontSize="sm" fontWeight="bold" lineHeight={1}>
      TT
    </Text>
  );
}

function XIcon() {
  return (
    <Text as="span" fontSize="sm" fontWeight="bold" lineHeight={1}>
      𝕏
    </Text>
  );
}

const AuthenticatedClipperIntegrationsView: React.FC = () => {
  const { theme } = useTheme();
  const {
    isConnected: isYoutubeConnected,
    channelTitle: youtubeChannelTitle,
    isChecking: isYoutubeChecking,
    refreshStatus: refreshYoutubeStatus,
    setConnected: setYoutubeConnected,
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((s) => s.platforms);
  const refreshSocial = useSocialStore((s) => s.refreshAll);

  const [isYoutubeConnecting, setIsYoutubeConnecting] = useState(false);
  const [connectingFlow, setConnectingFlow] = useState<SocialOAuthFlow | null>(
    null,
  );
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<
    SocialPublishablePlatform | "youtube" | null
  >(null);
  const [metaTargets, setMetaTargets] = useState<MetaTargetsResponse | null>(null);
  const [selectedMetaPageId, setSelectedMetaPageId] = useState<string | null>(null);
  const [isSavingMetaTarget, setIsSavingMetaTarget] = useState(false);

  const loadMetaTargets = useCallback(async () => {
    try {
      const targets = await socialAuthService.getMetaTargets();
      setMetaTargets(targets);
      setSelectedMetaPageId((current) =>
        current && targets.targets.some((target) => target.id === current)
          ? current
          : targets.targets[0]?.id ?? null,
      );
    } catch {
      setMetaTargets(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([refreshYoutubeStatus(), refreshSocial()]);
      await loadMetaTargets();
    })();
  }, [loadMetaTargets, refreshYoutubeStatus, refreshSocial]);

  const handleConnectYoutube = useCallback(() => {
    setIsYoutubeConnecting(true);
    void youtubeAuthService
      .redirectToYoutubeConnect(INTEGRATIONS_RETURN_PATH)
      .catch(() => {
        appToast.error(
          "Could not open YouTube",
          "Please try again.",
        );
      })
      .finally(() => {
        setIsYoutubeConnecting(false);
      });
  }, []);

  const handleConnectSocial = useCallback((flow: SocialOAuthFlow) => {
    setConnectingFlow(flow);
    logIntegration("integrations.connect_clicked", { flow });
    void socialAuthService
      .redirectToConnect(flow, INTEGRATIONS_RETURN_PATH)
      .catch(() => {
        appToast.error(
          "Could not start connection",
          "Please try again.",
        );
      })
      .finally(() => {
        setConnectingFlow(null);
      });
  }, []);

  const handleDisconnectYoutube = useCallback(() => {
    setDisconnectingPlatform("youtube");
    logIntegration("integrations.disconnect_clicked", { platform: "youtube" });
    void youtubeAuthService
      .disconnectYoutube()
      .then(() => {
        setYoutubeConnected(false, null);
        appToast.success("YouTube disconnected");
      })
      .catch((error: unknown) => {
        appToast.error(
          "Could not disconnect YouTube",
          error instanceof Error ? error.message : "Please try again.",
        );
      })
      .finally(() => {
        setDisconnectingPlatform(null);
      });
  }, [setYoutubeConnected]);

  const handleDisconnectSocial = useCallback(
    (platform: SocialPublishablePlatform) => {
      setDisconnectingPlatform(platform);
      logIntegration("integrations.disconnect_clicked", { platform });
      void socialAuthService
        .disconnect(platform)
        .then(async () => {
          await refreshSocial();
          appToast.success("Disconnected");
        })
        .catch((error: unknown) => {
          appToast.error(
            "Could not disconnect",
            error instanceof Error ? error.message : "Please try again.",
          );
        })
        .finally(() => {
          setDisconnectingPlatform(null);
        });
    },
    [refreshSocial],
  );

  const handleSelectMetaTarget = useCallback(() => {
    if (!selectedMetaPageId) return;
    setIsSavingMetaTarget(true);
    void socialAuthService
      .selectMetaTarget(selectedMetaPageId)
      .then(async () => {
        await Promise.all([refreshSocial(), loadMetaTargets()]);
        appToast.success("Meta connected", "Your Facebook Page and linked Instagram account are ready.");
      })
      .catch((error: unknown) => {
        appToast.error(
          "Could not select Facebook Page",
          error instanceof Error ? error.message : "Please try again.",
        );
      })
      .finally(() => setIsSavingMetaTarget(false));
  }, [loadMetaTargets, refreshSocial, selectedMetaPageId]);

  const fb = socialPlatforms.facebook;
  const ig = socialPlatforms.instagram;
  const tt = socialPlatforms.tiktok;
  const x = socialPlatforms.x;

  return (
    <VStack align="stretch" gap={8} w="full">
      <VStack align="start" gap={2} w="full">
        <SecondaryMainTitle
          fontSize={{ base: "2xl", md: "3xl" }}
          fontWeight="bold"
          color={theme.text.primary}
        >
          Integrations
        </SecondaryMainTitle>
        <Text color={theme.text.muted}>
          Connected services used for storage and publishing across your Clipper
          projects.
        </Text>
      </VStack>

      <VStack align="stretch" gap={3}>
        <IntegrationRow
          name="YouTube"
          icon={<Youtube size={20} color="#FF0000" />}
          isActive={isYoutubeConnected}
          isChecking={isYoutubeChecking}
          subtitle={isYoutubeConnected ? youtubeChannelTitle : null}
          onConnect={handleConnectYoutube}
          isConnecting={isYoutubeConnecting}
          onDisconnect={handleDisconnectYoutube}
          isDisconnecting={disconnectingPlatform === "youtube"}
        />
        <IntegrationRow
          name="Facebook"
          icon={<Facebook size={20} />}
          isActive={fb.connected}
          isChecking={fb.isChecking}
          subtitle={fb.connected ? fb.displayName : "Via Meta (Page)"}
          onConnect={() => handleConnectSocial("meta")}
          isConnecting={connectingFlow === "meta"}
          onDisconnect={() => handleDisconnectSocial("facebook")}
          isDisconnecting={disconnectingPlatform === "facebook"}
        />
        <IntegrationRow
          name="Instagram"
          icon={<Instagram size={20} />}
          isActive={ig.connected}
          isChecking={ig.isChecking}
          subtitle={
            ig.connected
              ? ig.displayName
              : "Connect an Instagram Business or Creator account"
          }
          onConnect={() => handleConnectSocial("instagram")}
          isConnecting={connectingFlow === "instagram"}
          onDisconnect={() => handleDisconnectSocial("instagram")}
          isDisconnecting={disconnectingPlatform === "instagram"}
        />
        <IntegrationRow
          name="TikTok"
          icon={<TikTokIcon />}
          isActive={tt.connected}
          isChecking={tt.isChecking}
          subtitle={tt.connected ? tt.displayName : null}
          onConnect={() => handleConnectSocial("tiktok")}
          isConnecting={connectingFlow === "tiktok"}
          onDisconnect={() => handleDisconnectSocial("tiktok")}
          isDisconnecting={disconnectingPlatform === "tiktok"}
        />
        <IntegrationRow
          name="X"
          icon={<XIcon />}
          isActive={x.connected}
          isChecking={x.isChecking}
          subtitle={x.connected ? x.displayName : null}
          onConnect={() => handleConnectSocial("x")}
          isConnecting={connectingFlow === "x"}
          onDisconnect={() => handleDisconnectSocial("x")}
          isDisconnecting={disconnectingPlatform === "x"}
        />
      </VStack>

      <StyledModal
        isOpen={metaTargets?.selectionRequired === true}
        onClose={() => setMetaTargets(null)}
        title="Choose your Meta publishing destination"
        size="md"
        isLoading={isSavingMetaTarget}
        closeOnOverlayClick={!isSavingMetaTarget}
      >
        <VStack align="stretch" gap={3}>
          <Text fontSize="sm" color={theme.text.muted}>
            {metaTargets?.profileName
              ? `Choose the Facebook Page to use with ${metaTargets.profileName}.`
              : "Choose the Facebook Page to use for publishing."}
          </Text>
          {(metaTargets?.targets ?? []).map((target) => {
            const selected = target.id === selectedMetaPageId;
            return (
              <Box
                key={target.id}
                as="button"
                textAlign="left"
                p={4}
                borderRadius="xl"
                border="1px solid"
                borderColor={selected ? colors.purple.medium : theme.dashboard.border}
                bg={selected ? theme.brand.purpleSoftAlpha12 : theme.background.card}
                onClick={() => {
                  if (isSavingMetaTarget) return;
                  setSelectedMetaPageId(target.id);
                }}
                aria-disabled={isSavingMetaTarget || undefined}
                pointerEvents={isSavingMetaTarget ? "none" : undefined}
                opacity={isSavingMetaTarget ? 0.65 : 1}
              >
                <Text fontWeight="semibold" color={theme.text.primary}>
                  {target.name}
                </Text>
                <Text mt={1} fontSize="sm" color={theme.text.muted}>
                  {target.instagramUserId
                    ? "Instagram Business/Creator account linked"
                    : "Facebook only — no linked Instagram Business account"}
                </Text>
              </Box>
            );
          })}
          <OutlinedActionButton
            width="100%"
            justifyContent="center"
            loading={isSavingMetaTarget}
            disabled={!selectedMetaPageId}
            onClick={handleSelectMetaTarget}
          >
            Use selected Page
          </OutlinedActionButton>
        </VStack>
      </StyledModal>
    </VStack>
  );
};

export const ClipperIntegrationsView: React.FC = () => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, isAuthenticated, hasTriedInit, isLoading, sessionMode } = useAuth();

  if (!hasTriedInit || isLoading) {
    return (
      <Box minH="260px">
        <AppLoader message="Checking account…" />
      </Box>
    );
  }

  const online = Boolean(user && token && isAuthenticated && sessionMode === "online");
  if (!online) {
    const guest = !user || !isAuthenticated;
    return (
      <VStack align="stretch" gap={6} w="full">
        <SecondaryMainTitle fontSize={{ base: "2xl", md: "3xl" }} color={theme.text.primary}>
          Integrations
        </SecondaryMainTitle>
        <Box
          w="full"
          p={6}
          borderRadius="2xl"
          border="1px solid"
          borderColor={theme.dashboard.border}
          bg={theme.background.card}
        >
          <HStack justify="space-between" align="center" gap={4} flexWrap="wrap">
            <VStack align="start" gap={2} flex={1} minW={0}>
              <Text color={theme.text.primary} fontWeight="semibold">
                {guest ? "Log in to use integrations" : "Integrations are unavailable offline"}
              </Text>
              <Text color={theme.text.muted}>
                Local projects, editing and export to disk remain available without an account.
              </Text>
            </VStack>
            {guest ? (
              <OutlinedActionButton
                flexShrink={0}
                onClick={() => {
                  rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
                  navigate("/auth");
                }}
              >
                Log in
              </OutlinedActionButton>
            ) : null}
          </HStack>
        </Box>
      </VStack>
    );
  }

  return <AuthenticatedClipperIntegrationsView />;
};
