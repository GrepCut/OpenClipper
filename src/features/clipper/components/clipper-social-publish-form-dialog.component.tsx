import React, { useMemo } from "react";
import { Box, Button, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";
import type { SocialPublishablePlatform } from "../../../services/social-auth.service";
import { PlatformIcon } from "./clipper-social-publish-dialog.constants";
import { ClipperSocialPublishStatus } from "./clipper-social-publish-status.component";
import { ClipperSocialPublishTikTokForm } from "./clipper-social-publish-tiktok-form.component";
import { ClipperSocialPublishYoutubeForm } from "./clipper-social-publish-youtube-form.component";
import type { ClipperSocialPublishController } from "./use-clipper-social-publish.hook";
import { TIKTOK_COMMERCIAL_REQUIRE_HINT } from "../shared/clipper-tiktok-publish.util";

export function ClipperSocialPublishFormDialog({
  isOpen,
  onClose,
  result,
  defaultConnected,
  accountLabel,
  ownerChannelLabel,
  onRequestConnect,
  publish,
  showInlineProgress,
}: {
  isOpen: boolean;
  onClose: () => void;
  result: ClipperFormatResult | null;
  defaultConnected: boolean;
  accountLabel: string | null;
  ownerChannelLabel?: string | null;
  onRequestConnect: (platform: SocialPublishablePlatform) => void;
  publish: ClipperSocialPublishController;
  showInlineProgress: boolean;
}) {
  const { theme } = useClipperUi();
  const isYoutube = publish.isYoutube;
  const isWideLayout = publish.isTikTok || isYoutube;
  const hideConnectedBanner = defaultConnected && isWideLayout;
  const busy = publish.isPublishing;

  const activeAccountLabel = useMemo(() => {
    const selected = publish.accountConnections.find(
      (connection) => connection.id === publish.selectedConnectionId,
    );
    return selected?.displayName ?? selected?.googleEmail ?? accountLabel;
  }, [publish.accountConnections, publish.selectedConnectionId, accountLabel]);

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Publish to ${publish.platformLabel}`}
      size={isWideLayout ? "xl" : "md"}
      contentWidth={isWideLayout ? "min(calc(100vw - 64px), 1320px)" : undefined}
      scrollBehavior={isWideLayout ? "outside" : "inside"}
      isLoading={busy}
      closeOnOverlayClick={!busy}
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={() => void publish.handlePublish()}
          submitText={defaultConnected ? "Publish" : `Connect ${publish.platformLabel}`}
          isLoading={busy}
          submitDisabled={publish.submitDisabled}
          submitTitle={
            publish.isTikTok
              && publish.commercialDisclosure
              && !publish.brandContent
              && !publish.brandOrganic
              ? TIKTOK_COMMERCIAL_REQUIRE_HINT
              : undefined
          }
        />
      }
    >
      <VStack align="stretch" gap={4} w="full">
        {!hideConnectedBanner ? (
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
                    disabled={busy}
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

        {isYoutube ? (
          <ClipperSocialPublishYoutubeForm
            result={result}
            isPublishing={busy}
            title={publish.title}
            setTitle={publish.setTitle}
            description={publish.description}
            setDescription={publish.setDescription}
            privacyStatus={publish.privacyStatus}
            setPrivacyStatus={publish.setPrivacyStatus}
            accountLabel={activeAccountLabel}
            ownerChannelLabel={ownerChannelLabel}
          />
        ) : null}

        {!publish.isTikTok && !isYoutube ? (
          <>
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
                disabled={busy}
              />
            </Box>
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
                disabled={busy}
              />
            </Box>
          </>
        ) : null}

        {publish.isTikTok ? (
          <ClipperSocialPublishTikTokForm
            result={result}
            isPublishing={busy}
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
            commercialDisclosure={publish.commercialDisclosure}
            setCommercialDisclosure={publish.setCommercialDisclosure}
            brandContent={publish.brandContent}
            setBrandContent={publish.setBrandContent}
            brandOrganic={publish.brandOrganic}
            setBrandOrganic={publish.setBrandOrganic}
            musicUsageConfirmed={publish.musicUsageConfirmed}
            setMusicUsageConfirmed={publish.setMusicUsageConfirmed}
          />
        ) : null}

        {showInlineProgress ? (
          <ClipperSocialPublishStatus
            isPublishing={busy}
            uploadPhase={publish.uploadPhase}
            uploadProgress={publish.uploadProgress}
            platformLabel={publish.platformLabel}
          />
        ) : null}
      </VStack>
    </StyledModal>
  );
}
