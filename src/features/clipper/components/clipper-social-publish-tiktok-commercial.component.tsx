import { Box, Checkbox, Text, VStack } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  TIKTOK_BRANDED_PRIVATE_HINT,
  TIKTOK_COMMERCIAL_REQUIRE_HINT,
  tiktokCommercialLabelCopy,
} from "../shared/clipper-tiktok-publish.util";
import { ToggleOptionButton } from "./clipper-social-publish-toggle.component";

export function ClipperSocialPublishTikTokCommercial({
  isPublishing,
  commercialDisclosure,
  onCommercialDisclosureChange,
  brandOrganic,
  onBrandOrganicChange,
  brandContent,
  onBrandContentChange,
}: {
  isPublishing: boolean;
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

  return (
    <Box>
      <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
        Content disclosure
      </Text>
      <ToggleOptionButton
        isSelected={commercialDisclosure}
        onClick={() => onCommercialDisclosureChange(!commercialDisclosure)}
        disabled={isPublishing}
        w="full"
        justifyContent="flex-start"
        whiteSpace="normal"
        h="auto"
        minH="36px"
        py={2}
      >
        This content promotes yourself, a brand, product or service
      </ToggleOptionButton>

      {commercialDisclosure ? (
        <VStack
          align="stretch"
          gap={2}
          mt={2}
          title={needsSelection ? TIKTOK_COMMERCIAL_REQUIRE_HINT : undefined}
        >
          <Checkbox.Root
            size="sm"
            colorPalette="blue"
            checked={brandOrganic}
            disabled={isPublishing}
            onCheckedChange={(details) => onBrandOrganicChange(details.checked === true)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Label>
              <Text fontSize="sm" color={theme.text.primary}>
                Your brand
              </Text>
            </Checkbox.Label>
          </Checkbox.Root>
          <Text fontSize="xs" color={theme.text.muted} pl={6}>
            You are promoting yourself or your own business.
          </Text>

          <Checkbox.Root
            size="sm"
            colorPalette="blue"
            checked={brandContent}
            disabled={isPublishing}
            onCheckedChange={(details) => onBrandContentChange(details.checked === true)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Label>
              <Text fontSize="sm" color={theme.text.primary}>
                Branded content
              </Text>
            </Checkbox.Label>
          </Checkbox.Root>
          <Text fontSize="xs" color={theme.text.muted} pl={6}>
            You are promoting another brand or a third party.
            {brandContent ? ` ${TIKTOK_BRANDED_PRIVATE_HINT}` : ""}
          </Text>

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
