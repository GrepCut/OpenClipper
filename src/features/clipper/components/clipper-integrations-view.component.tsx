import React, { useCallback, useEffect, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  HardDrive,
  Youtube,
  Instagram,
  Facebook,
  Linkedin,
} from "lucide-react";
import { colors, useTheme } from "../../../theme";
import { googleAuthService } from "../../../services/google-auth.service";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import { socialAuthService } from "../../../services/social-auth.service";
import type {
  MetaTargetsResponse,
  SocialOAuthFlow,
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

const INTEGRATIONS_RETURN_PATH = "/clipper?tab=integrations";

interface IntegrationRowProps {
  name: string;
  icon: React.ReactNode;
  isActive: boolean;
  isChecking: boolean;
  subtitle?: string | null;
  onConnect?: () => void;
  isConnecting?: boolean;
  onChangeConnection?: () => void;
}

function IntegrationRow({
  name,
  icon,
  isActive,
  isChecking,
  subtitle,
  onConnect,
  isConnecting = false,
  onChangeConnection,
}: IntegrationRowProps) {
  const { theme, mode } = useTheme();
  const rowBg = mode === "dark" ? theme.background.card : "gray.50";
  const showConnect = !isActive && !isChecking && onConnect;

  return (
    <Box bg={rowBg} borderRadius="2xl" p={{ base: 4, md: 5 }}>
      <VStack align="stretch" gap={3}>
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

          <Box
            flexShrink={0}
            px={2.5}
            py={0.5}
            borderRadius="full"
            bg={mode === "dark" ? theme.brand.purpleSoftAlpha12 : theme.brand.toggleActiveBg}
            color={colors.purple.medium}
            fontSize="xs"
            fontWeight="semibold"
            whiteSpace="nowrap"
          >
            {isChecking ? "Checking…" : isActive ? "Active" : "Inactive"}
          </Box>
        </HStack>
        {showConnect || (isActive && !isChecking && onChangeConnection) ? (
          <HStack justify="end" gap={2} flexWrap="wrap">
            {showConnect ? (
              <OutlinedActionButton
                loading={isConnecting}
                onClick={onConnect}
                whiteSpace="nowrap"
              >
                Connect {name}
              </OutlinedActionButton>
            ) : null}
            {isActive && !isChecking && onChangeConnection ? (
              <OutlinedActionButton onClick={onChangeConnection} whiteSpace="nowrap">
                Change account
              </OutlinedActionButton>
            ) : null}
          </HStack>
        ) : null}
      </VStack>
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
  } = useYoutubeStore();
  const socialPlatforms = useSocialStore((s) => s.platforms);
  const refreshSocial = useSocialStore((s) => s.refreshAll);

  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [isDriveChecking, setIsDriveChecking] = useState(true);
  const [isDriveConnecting, setIsDriveConnecting] = useState(false);
  const [isYoutubeConnecting, setIsYoutubeConnecting] = useState(false);
  const [connectingFlow, setConnectingFlow] = useState<SocialOAuthFlow | null>(
    null,
  );
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
    let cancelled = false;

    const loadStatuses = async () => {
      setIsDriveChecking(true);
      const [driveConnected] = await Promise.all([
        googleAuthService.checkDriveConnection(),
        refreshYoutubeStatus(),
        refreshSocial(),
      ]);
      await loadMetaTargets();
      if (!cancelled) {
        setIsDriveConnected(driveConnected);
        setIsDriveChecking(false);
      }
    };

    void loadStatuses();

    return () => {
      cancelled = true;
    };
  }, [loadMetaTargets, refreshYoutubeStatus, refreshSocial]);

  const handleConnectDrive = useCallback(() => {
    setIsDriveConnecting(true);
    void googleAuthService
      .redirectToDriveConnect(INTEGRATIONS_RETURN_PATH)
      .catch(() => {
        setIsDriveConnecting(false);
      });
  }, []);

  const handleConnectYoutube = useCallback(() => {
    setIsYoutubeConnecting(true);
    void youtubeAuthService
      .redirectToYoutubeConnect(INTEGRATIONS_RETURN_PATH)
      .catch(() => {
        setIsYoutubeConnecting(false);
      });
  }, []);

  const handleConnectSocial = useCallback((flow: SocialOAuthFlow) => {
    setConnectingFlow(flow);
    void socialAuthService
      .redirectToConnect(flow, INTEGRATIONS_RETURN_PATH)
      .catch(() => {
        setConnectingFlow(null);
      });
  }, []);

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
  const li = socialPlatforms.linkedin;
  const x = socialPlatforms.x;

  return (
    <VStack align="stretch" gap={8}>
      <VStack align="start" gap={2} maxW="640px">
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
          name="Google Drive"
          icon={<HardDrive size={20} />}
          isActive={isDriveConnected}
          isChecking={isDriveChecking}
          onConnect={handleConnectDrive}
          isConnecting={isDriveConnecting}
        />
        <IntegrationRow
          name="YouTube"
          icon={<Youtube size={20} color="#FF0000" />}
          isActive={isYoutubeConnected}
          isChecking={isYoutubeChecking}
          subtitle={isYoutubeConnected ? youtubeChannelTitle : null}
          onConnect={handleConnectYoutube}
          isConnecting={isYoutubeConnecting}
        />
        <IntegrationRow
          name="Facebook"
          icon={<Facebook size={20} />}
          isActive={fb.connected}
          isChecking={fb.isChecking}
          subtitle={fb.connected ? fb.displayName : "Via Meta (Page)"}
          onConnect={() => handleConnectSocial("meta")}
          isConnecting={connectingFlow === "meta"}
          onChangeConnection={() => handleConnectSocial("meta")}
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
          onChangeConnection={() => handleConnectSocial("instagram")}
        />
        <IntegrationRow
          name="TikTok"
          icon={<TikTokIcon />}
          isActive={tt.connected}
          isChecking={tt.isChecking}
          subtitle={tt.connected ? tt.displayName : null}
          onConnect={() => handleConnectSocial("tiktok")}
          isConnecting={connectingFlow === "tiktok"}
        />
        <IntegrationRow
          name="LinkedIn"
          icon={<Linkedin size={20} />}
          isActive={li.connected}
          isChecking={li.isChecking}
          subtitle={li.connected ? li.displayName : null}
          onConnect={() => handleConnectSocial("linkedin")}
          isConnecting={connectingFlow === "linkedin"}
        />
        <IntegrationRow
          name="X"
          icon={<XIcon />}
          isActive={x.connected}
          isChecking={x.isChecking}
          subtitle={x.connected ? x.displayName : null}
          onConnect={() => handleConnectSocial("x")}
          isConnecting={connectingFlow === "x"}
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
                type="button"
                textAlign="left"
                p={4}
                borderRadius="xl"
                border="1px solid"
                borderColor={selected ? theme.brand.primary : theme.dashboard.border}
                bg={selected ? theme.brand.purpleSoftAlpha12 : theme.background.card}
                onClick={() => setSelectedMetaPageId(target.id)}
                disabled={isSavingMetaTarget}
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
      <VStack align="stretch" gap={6} maxW="680px">
        <SecondaryMainTitle fontSize={{ base: "2xl", md: "3xl" }} color={theme.text.primary}>
          Integrations
        </SecondaryMainTitle>
        <Box p={6} borderRadius="2xl" border="1px solid" borderColor={theme.dashboard.border} bg={theme.background.card}>
          <Text color={theme.text.primary} fontWeight="semibold" mb={2}>
            {guest ? "Log in to use integrations" : "Integrations are unavailable offline"}
          </Text>
          <Text color={theme.text.muted} mb={5}>
            Local projects, editing and export to disk remain available without an account.
          </Text>
          {guest ? (
            <OutlinedActionButton
              onClick={() => {
                rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
                navigate("/auth");
              }}
            >
              Log in
            </OutlinedActionButton>
          ) : null}
        </Box>
      </VStack>
    );
  }

  return <AuthenticatedClipperIntegrationsView />;
};
