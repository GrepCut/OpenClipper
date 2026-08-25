import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "../../../services/social-auth.service";
import type { ClipperFormatResult } from "../shared/state.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  formatTikTokBlockerMessage,
  TIKTOK_BRANDED_PRIVATE_HINT,
  TIKTOK_PRIVACY_LABELS,
  TIKTOK_PROCESSING_NOTICE,
  TIKTOK_TITLE_MAX_LENGTH,
  tiktokConsentCopy,
} from "../shared/clipper-tiktok-publish.util";
import { ClipperSocialPublishTwoColumn } from "./clipper-social-publish-preview.component";
import { ClipperSocialPublishTikTokCommercial } from "./clipper-social-publish-tiktok-commercial.component";
import { ToggleOptionButton } from "./clipper-social-publish-toggle.component";

interface ClipperSocialPublishTikTokFormProps {
  result: ClipperFormatResult | null;
  isPublishing: boolean;
  title: string;
  setTitle: (value: string) => void;
  tiktokCreator: TikTokCreatorInfo | null;
  tiktokError: string | null;
  tiktokPrivacy: TikTokPrivacyLevel | "";
  setTikTokPrivacy: (value: TikTokPrivacyLevel | "") => void;
  allowComment: boolean;
  setAllowComment: React.Dispatch<React.SetStateAction<boolean>>;
  allowDuet: boolean;
  setAllowDuet: React.Dispatch<React.SetStateAction<boolean>>;
  allowStitch: boolean;
  setAllowStitch: React.Dispatch<React.SetStateAction<boolean>>;
  isAigc: boolean;
  setIsAigc: React.Dispatch<React.SetStateAction<boolean>>;
  commercialDisclosure: boolean;
  setCommercialDisclosure: (value: boolean) => void;
  brandContent: boolean;
  setBrandContent: (value: boolean) => void;
  brandOrganic: boolean;
  setBrandOrganic: React.Dispatch<React.SetStateAction<boolean>>;
  musicUsageConfirmed: boolean;
  setMusicUsageConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ClipperSocialPublishTikTokForm({
  result,
  isPublishing,
  title,
  setTitle,
  tiktokCreator,
  tiktokError,
  tiktokPrivacy,
  setTikTokPrivacy,
  allowComment,
  setAllowComment,
  allowDuet,
  setAllowDuet,
  allowStitch,
  setAllowStitch,
  isAigc,
  setIsAigc,
  commercialDisclosure,
  setCommercialDisclosure,
  brandContent,
  setBrandContent,
  brandOrganic,
  setBrandOrganic,
  musicUsageConfirmed,
  setMusicUsageConfirmed,
}: ClipperSocialPublishTikTokFormProps) {
  const { theme, mode } = useClipperUi();
  const selfOnlyDisabled = brandContent;
  const blocker = tiktokError
    || (!tiktokCreator?.canPost && tiktokCreator?.blockerMessage
      ? formatTikTokBlockerMessage(tiktokCreator.blockerMessage)
      : null);

  return (
    <ClipperSocialPublishTwoColumn result={result}>
      <VStack
        flex={1}
        minW={0}
        h={{ lg: "100%" }}
        align="stretch"
        gap={2}
        justify="space-between"
      >
        <VStack align="stretch" gap={2} flex={1} minH={0} overflowY="auto">
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
              {tiktokCreator?.nickname || "TikTok account"}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              {tiktokCreator?.username
                ? `@${tiktokCreator.username}`
                : "Loading current TikTok posting settings…"}
            </Text>
            {blocker ? (
              <Text mt={1} fontSize="xs" color={theme.status.error}>
                {blocker}
              </Text>
            ) : null}
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Title
            </Text>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TIKTOK_TITLE_MAX_LENGTH))}
              maxLength={TIKTOK_TITLE_MAX_LENGTH}
              borderRadius="xl"
              bg={theme.surface.subtle}
              borderColor={theme.surface.borderStrong}
              color={theme.text.primary}
              disabled={isPublishing}
            />
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Privacy (required)
            </Text>
            <Box
              as="select"
              value={tiktokPrivacy}
              disabled={isPublishing || !tiktokCreator}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                setTikTokPrivacy((event.target.value || "") as TikTokPrivacyLevel | "");
              }}
              w="full"
              h="36px"
              px={3}
              borderRadius="xl"
              borderWidth="1px"
              borderStyle="solid"
              bg={theme.surface.subtle}
              borderColor={theme.surface.borderStrong}
              color={theme.text.primary}
              fontSize="sm"
              css={{ colorScheme: mode === "dark" ? "dark" : "light" }}
              title={selfOnlyDisabled ? TIKTOK_BRANDED_PRIVATE_HINT : undefined}
            >
              <option value="">Select privacy</option>
              {(tiktokCreator?.privacyLevelOptions ?? []).map((option) => (
                <option
                  key={option}
                  value={option}
                  disabled={option === "SELF_ONLY" && selfOnlyDisabled}
                >
                  {TIKTOK_PRIVACY_LABELS[option]}
                </option>
              ))}
            </Box>
            {selfOnlyDisabled ? (
              <Text mt={1} fontSize="xs" color={theme.text.muted}>
                {TIKTOK_BRANDED_PRIVATE_HINT}
              </Text>
            ) : null}
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Allow interactions
            </Text>
            <HStack gap={2} flexWrap="wrap">
              <ToggleOptionButton
                isSelected={allowComment}
                onClick={() => setAllowComment((v) => !v)}
                disabled={isPublishing || Boolean(tiktokCreator?.commentDisabled)}
              >
                Allow Comment
              </ToggleOptionButton>
              <ToggleOptionButton
                isSelected={allowDuet}
                onClick={() => setAllowDuet((v) => !v)}
                disabled={isPublishing || Boolean(tiktokCreator?.duetDisabled)}
              >
                Allow Duet
              </ToggleOptionButton>
              <ToggleOptionButton
                isSelected={allowStitch}
                onClick={() => setAllowStitch((v) => !v)}
                disabled={isPublishing || Boolean(tiktokCreator?.stitchDisabled)}
              >
                Allow Stitch
              </ToggleOptionButton>
            </HStack>
          </Box>

          <Box>
            <ToggleOptionButton
              isSelected={isAigc}
              onClick={() => setIsAigc((v) => !v)}
              disabled={isPublishing}
            >
              AI-generated content
            </ToggleOptionButton>
          </Box>

          <ClipperSocialPublishTikTokCommercial
            isPublishing={isPublishing}
            commercialDisclosure={commercialDisclosure}
            onCommercialDisclosureChange={setCommercialDisclosure}
            brandOrganic={brandOrganic}
            onBrandOrganicChange={(value) => setBrandOrganic(value)}
            brandContent={brandContent}
            onBrandContentChange={setBrandContent}
          />
        </VStack>

        <VStack align="stretch" gap={2}>
          <Text fontSize="xs" color={theme.text.muted}>
            {TIKTOK_PROCESSING_NOTICE}
          </Text>
          <ToggleOptionButton
            isSelected={musicUsageConfirmed}
            onClick={() => setMusicUsageConfirmed((v) => !v)}
            disabled={isPublishing}
            w="full"
            justifyContent="flex-start"
            whiteSpace="normal"
            h="auto"
            minH="36px"
            py={2}
          >
            {tiktokConsentCopy(brandContent)}
          </ToggleOptionButton>
        </VStack>
      </VStack>
    </ClipperSocialPublishTwoColumn>
  );
}
