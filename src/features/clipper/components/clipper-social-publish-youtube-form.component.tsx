import { Box, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import type { SocialPrivacyStatus } from "../../../services/social-auth.service";
import type { ClipperFormatResult } from "../shared/state.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { PRIVACY_OPTIONS } from "./clipper-social-publish-dialog.constants";
import { ClipperSocialPublishTwoColumn } from "./clipper-social-publish-preview.component";
import { ToggleOptionButton } from "./clipper-social-publish-toggle.component";

interface ClipperSocialPublishYoutubeFormProps {
  result: ClipperFormatResult | null;
  isPublishing: boolean;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  privacyStatus: SocialPrivacyStatus;
  setPrivacyStatus: (value: SocialPrivacyStatus) => void;
  accountLabel: string | null;
  ownerChannelLabel?: string | null;
}

export function ClipperSocialPublishYoutubeForm({
  result,
  isPublishing,
  title,
  setTitle,
  description,
  setDescription,
  privacyStatus,
  setPrivacyStatus,
  accountLabel,
  ownerChannelLabel,
}: ClipperSocialPublishYoutubeFormProps) {
  const { theme } = useClipperUi();

  return (
    <ClipperSocialPublishTwoColumn result={result}>
      <VStack flex={1} minW={0} h={{ lg: "100%" }} align="stretch" gap={2} minH={0}>
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            {accountLabel || "YouTube account"}
          </Text>
          <Text fontSize="xs" color={theme.text.muted}>
            {ownerChannelLabel
              ? `Publishing as owner channel: ${ownerChannelLabel}`
              : "Upload uses your linked account."}
          </Text>
        </Box>

        <Box>
          <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
            Title
          </Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            borderRadius="xl"
            bg={theme.surface.subtle}
            borderColor={theme.surface.borderStrong}
            color={theme.text.primary}
            disabled={isPublishing}
          />
        </Box>

        <Box flex={1} minH={0} display="flex" flexDirection="column">
          <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
            Description
          </Text>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            flex={1}
            minH="96px"
            rows={4}
            borderRadius="xl"
            bg={theme.surface.subtle}
            borderColor={theme.surface.borderStrong}
            color={theme.text.primary}
            disabled={isPublishing}
          />
        </Box>

        <Box>
          <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
            Privacy
          </Text>
          <HStack gap={2} flexWrap="wrap">
            {PRIVACY_OPTIONS.map((option) => (
              <ToggleOptionButton
                key={option.value}
                isSelected={privacyStatus === option.value}
                onClick={() => setPrivacyStatus(option.value)}
                disabled={isPublishing}
              >
                {option.label}
              </ToggleOptionButton>
            ))}
          </HStack>
        </Box>
      </VStack>
    </ClipperSocialPublishTwoColumn>
  );
}
