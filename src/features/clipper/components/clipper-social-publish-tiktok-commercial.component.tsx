import { Box, Text, VStack } from "@chakra-ui/react";
import type { TikTokPrivacyLevel } from "../../../services/social-auth.service";
import { ThemedCheckbox } from "../../../shared/components/ui/themed-checkbox.component";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  isTikTokBrandedContentLocked,
  TIKTOK_BRANDED_PRIVATE_HINT,
  TIKTOK_COMMERCIAL_REQUIRE_HINT,
  tiktokCommercialLabelCopy,
} from "../shared/clipper-tiktok-publish.util";

export function ClipperSocialPublishTikTokCommercial({
  isPublishing,
  privacyLevel,
  commercialDisclosure,
  onCommercialDisclosureChange,
  brandOrganic,
  onBrandOrganicChange,
  brandContent,
  onBrandContentChange,
}: {
  isPublishing: boolean;
  privacyLevel: TikTokPrivacyLevel | "";
  commercialDisclosure: boolean;
  onCommercialDisclosureChange: (value: boolean) => void;
  brandOrganic: boolean;
  onBrandOrganicChange: (value: boolean) => void;
  brandContent: boolean;
  onBrandContentChange: (value: boolean) => void;
}) {
  const { theme } = useClipperUi();
  const labelCopy = tiktokCommercialLabelCopy({ brandOrganic, brandContent });
  const needsSelection = commercialDisclosure && !brandOrganic && !brandContent;
  const brandedContentLocked = isTikTokBrandedContentLocked({ privacyLevel });

  return (
    <Box>
      <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
        Content disclosure
      </Text>
      <ThemedCheckbox
        checked={commercialDisclosure}
        onCheckedChange={onCommercialDisclosureChange}
        disabled={isPublishing}
      >
        This content promotes yourself, a brand, product or service
      </ThemedCheckbox>

      {commercialDisclosure ? (
        <VStack
          align="stretch"
          gap={3}
          mt={2}
          px={3}
          py={3}
          ml={6}
          borderRadius="xl"
          bg={theme.surface.subtle}
          borderWidth="1px"
          borderColor={theme.surface.borderStrong}
          title={needsSelection ? TIKTOK_COMMERCIAL_REQUIRE_HINT : undefined}
        >
          <VStack align="stretch" gap={0.5}>
            <ThemedCheckbox
              checked={brandOrganic}
              onCheckedChange={onBrandOrganicChange}
              disabled={isPublishing}
            >
              Your brand
            </ThemedCheckbox>
            <Text fontSize="xs" color={theme.text.muted} ps={6}>
              You are promoting yourself or your own business.
            </Text>
          </VStack>

          <VStack align="stretch" gap={0.5}>
            <ThemedCheckbox
              checked={brandContent}
              onCheckedChange={onBrandContentChange}
              disabled={isPublishing || brandedContentLocked}
            >
              Branded content
            </ThemedCheckbox>
            <Text fontSize="xs" color={theme.text.muted} ps={6}>
              You are promoting another brand or a third party.
              {brandedContentLocked ? ` ${TIKTOK_BRANDED_PRIVATE_HINT}` : ""}
            </Text>
          </VStack>

          {labelCopy ? (
            <Text fontSize="xs" color={theme.text.distinct}>
              {labelCopy}
            </Text>
          ) : needsSelection ? (
            <Text fontSize="xs" color={theme.status.error}>
              {TIKTOK_COMMERCIAL_REQUIRE_HINT}
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </Box>
  );
}
