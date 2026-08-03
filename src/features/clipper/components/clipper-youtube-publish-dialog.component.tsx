import React, { useMemo } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Progress,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  PRIVACY_OPTIONS,
  PlatformIcon,
  type ClipperSocialPublishDialogProps,
} from "./clipper-social-publish-dialog.constants";
import { useClipperSocialPublish } from "./use-clipper-social-publish.hook";
import { ClipperSocialPublishTikTokForm } from "./clipper-social-publish-tiktok-form.component";

export const ClipperSocialPublishDialog: React.FC<ClipperSocialPublishDialogProps> = ({
  isOpen,
  onClose,
  projectId,
  result,
  sourceFileName,
  defaultConnected,
  accountLabel,
  accountConnections,
  ownerChannelLabel,
  publishPlatform: requestedPlatform,
  onRequestConnect,
  onPublishComplete,
}) => {
  const { theme } = useClipperUi();
  const publish = useClipperSocialPublish({
    isOpen,
    result,
    sourceFileName,
    defaultConnected,
    accountConnections,
    requestedPlatform,
    projectId,
    onRequestConnect,
    onPublishComplete,
  });

  const activeAccountLabel = useMemo(() => {
    const selected = publish.accountConnections.find(
      (connection) => connection.id === publish.selectedConnectionId,
    );
    return (
      selected?.displayName ??
      selected?.googleEmail ??
      accountLabel
    );
  }, [
    publish.accountConnections,
    publish.selectedConnectionId,
    accountLabel,
  ]);

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Publish to ${publish.platformLabel}`}
      size={publish.isTikTok ? "xl" : "md"}
      contentWidth={publish.isTikTok ? "min(calc(100vw - 64px), 1320px)" : undefined}
      scrollBehavior={publish.isTikTok ? "outside" : "inside"}
      isLoading={publish.isPublishing}
      closeOnOverlayClick={!publish.isPublishing}
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={() => void publish.handlePublish()}
          submitText={defaultConnected ? "Publish" : `Connect ${publish.platformLabel}`}
          isLoading={publish.isPublishing}
          submitDisabled={publish.submitDisabled}
        />
      }
    >
      <VStack align="stretch" gap={4} w="full">
        {!publish.isTikTok || !defaultConnected ? (
        <HStack
          gap={3}
          p={3}
          borderRadius="xl"
          bg={theme.surface.subtle}
          border="1px solid"
          borderColor={theme.surface.hover}
        >
          <Box>
            <PlatformIcon platform={publish.platform} />
          </Box>
          <Box flex={1}>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
              {defaultConnected
                ? activeAccountLabel
                  ? `Connected: ${activeAccountLabel}`
                  : `${publish.platformLabel} connected`
                : `${publish.platformLabel} not connected`}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              {defaultConnected
                ? ownerChannelLabel
                  ? `Publishing as owner channel: ${ownerChannelLabel}`
                  : publish.accountConnections.length > 1
                    ? "Choose which linked account to publish to."
                    : "Upload uses your linked account."
                : "Connect your account before publishing."}
            </Text>
          </Box>
          {!defaultConnected ? (
            <Button
              size="sm"
              variant="outline"
              borderRadius="lg"
              onClick={() => onRequestConnect(publish.platform)}
            >
              Connect
            </Button>
          ) : null}
        </HStack>
        ) : null}

        {defaultConnected && publish.accountConnections.length > 1 ? (
          <Box>
            <Text fontSize="sm" mb={2} color={theme.text.distinct}>
              Account
            </Text>
            <VStack align="stretch" gap={2}>
              {publish.accountConnections.map((connection) => {
                const selected = connection.id === publish.selectedConnectionId;
                return (
                  <Button
                    key={connection.id}
                    size="sm"
                    justifyContent="flex-start"
                    borderRadius="xl"
                    variant={selected ? "solid" : "outline"}
                    bg={selected ? clipperTheme.accent : "transparent"}
                    color={theme.text.primary}
                    borderColor={theme.surface.elevated}
                    onClick={() => publish.setSelectedConnectionId(connection.id)}
                    disabled={publish.isPublishing}
                  >
                    {connection.displayName ||
                      connection.googleEmail ||
                      connection.externalAccountId ||
                      "Connected account"}
                  </Button>
                );
              })}
            </VStack>
          </Box>
        ) : null}

        {!publish.isTikTok ? (
          <Box>
            <Text fontSize="sm" mb={2} color={theme.text.distinct}>
              Title
            </Text>
            <Input
              value={publish.title}
              onChange={(e) => publish.setTitle(e.target.value)}
              borderRadius="xl"
              bg={theme.surface.subtle}
              borderColor={theme.surface.borderStrong}
              color={theme.text.primary}
              disabled={publish.isPublishing}
            />
          </Box>
        ) : null}

        {!publish.isTikTok ? (
          <Box>
            <Text fontSize="sm" mb={2} color={theme.text.distinct}>
              Description
            </Text>
            <Textarea
              value={publish.description}
              onChange={(e) => publish.setDescription(e.target.value)}
              rows={4}
              borderRadius="xl"
              bg={theme.surface.subtle}
              borderColor={theme.surface.borderStrong}
              color={theme.text.primary}
              disabled={publish.isPublishing}
            />
          </Box>
        ) : null}

        {publish.isTikTok ? (
          <ClipperSocialPublishTikTokForm
            result={result}
            isPublishing={publish.isPublishing}
            title={publish.title}
            setTitle={publish.setTitle}
            tiktokCreator={publish.tiktokCreator}
            tiktokError={publish.tiktokError}
            tiktokPrivacy={publish.tiktokPrivacy}
            setTikTokPrivacy={publish.setTikTokPrivacy}
            allowComment={publish.allowComment}
            setAllowComment={publish.setAllowComment}
            allowDuet={publish.allowDuet}
            setAllowDuet={publish.setAllowDuet}
            allowStitch={publish.allowStitch}
            setAllowStitch={publish.setAllowStitch}
            isAigc={publish.isAigc}
            setIsAigc={publish.setIsAigc}
            brandContent={publish.brandContent}
            setBrandContent={publish.setBrandContent}
            brandOrganic={publish.brandOrganic}
            setBrandOrganic={publish.setBrandOrganic}
            musicUsageConfirmed={publish.musicUsageConfirmed}
            setMusicUsageConfirmed={publish.setMusicUsageConfirmed}
          />
        ) : null}

        {publish.platform === "youtube" ? (
          <Box>
            <Text fontSize="sm" mb={2} color={theme.text.distinct}>
              Privacy
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {PRIVACY_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  borderRadius="xl"
                  variant={publish.privacyStatus === option.value ? "solid" : "outline"}
                  bg={
                    publish.privacyStatus === option.value
                      ? clipperTheme.accent
                      : "transparent"
                  }
                  color={theme.text.primary}
                  borderColor={theme.surface.elevated}
                  onClick={() => publish.setPrivacyStatus(option.value)}
                  disabled={publish.isPublishing}
                >
                  {option.label}
                </Button>
              ))}
            </HStack>
          </Box>
        ) : null}

        {publish.isPublishing ? (
          <Box>
            <Text fontSize="xs" mb={2} color={theme.text.muted}>
              {publish.uploadPhase === "uploading"
                ? `Uploading video… ${Math.round(publish.uploadProgress * 100)}%`
                : `Publishing to ${publish.platformLabel}…`}
            </Text>
            <Progress.Root
              value={publish.uploadPhase === "uploading" ? publish.uploadProgress * 100 : null}
              max={100}
            >
              <Progress.Track borderRadius="full" bg={theme.surface.hover}>
                <Progress.Range bg={clipperTheme.accent} />
              </Progress.Track>
            </Progress.Root>
          </Box>
        ) : null}

        {publish.watchUrl ? (
          <Box
            p={3}
            borderRadius="xl"
            bg={`rgba(${clipperTheme.accentTintRgb},0.12)`}
            border={`1px solid ${clipperTheme.accentGlow}`}
          >
            <Text fontSize="sm" color={theme.text.primary} mb={2}>
              Published successfully.
            </Text>
            <Box asChild>
              <a href={publish.watchUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  size="sm"
                  borderRadius="xl"
                  bg={clipperTheme.accent}
                  color={theme.text.onBrand}
                >
                  Open on {publish.platformLabel}
                </Button>
              </a>
            </Box>
          </Box>
        ) : null}
      </VStack>
    </StyledModal>
  );
};

/** @deprecated Prefer ClipperSocialPublishDialog */
export const ClipperYoutubePublishDialog = ClipperSocialPublishDialog;
