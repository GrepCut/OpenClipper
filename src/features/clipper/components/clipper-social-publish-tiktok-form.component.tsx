import { useMemo } from "react";
import { Box, Input, Text, VStack } from "@chakra-ui/react";
import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "../../../services/social-auth.service";
import { ThemedCheckbox } from "../../../shared/components/ui/themed-checkbox.component";
import { ThemedSelect } from "../../../shared/components/ui/themed-select.component";
import type { ClipperFormatResult } from "../shared/state.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  formatTikTokBlockerMessage,
  isTikTokSelfOnlyOptionDisabled,
  TIKTOK_BRANDED_PRIVATE_HINT,
  TIKTOK_PRIVACY_LABELS,
  TIKTOK_PROCESSING_NOTICE,
  TIKTOK_TITLE_MAX_LENGTH,
  tiktokConsentCopy,
} from "../shared/clipper-tiktok-publish.util";
import { ClipperSocialPublishTwoColumn } from "./clipper-social-publish-preview.component";
import { ClipperSocialPublishTikTokCommercial } from "./clipper-social-publish-tiktok-commercial.component";

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
  const { theme } = useClipperUi();
  const selfOnlyOptionDisabled = isTikTokSelfOnlyOptionDisabled({ brandContent });
  const blocker = tiktokError
    || (!tiktokCreator?.canPost && tiktokCreator?.blockerMessage
      ? formatTikTokBlockerMessage(tiktokCreator.blockerMessage)
      : null);
  const privacyOptions = useMemo(
    () =>
      (tiktokCreator?.privacyLevelOptions ?? []).map((option) => ({
        value: option,
        label: TIKTOK_PRIVACY_LABELS[option],
        disabled: option === "SELF_ONLY" && selfOnlyOptionDisabled,
      })),
    [selfOnlyOptionDisabled, tiktokCreator?.privacyLevelOptions],
  );

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
            <ThemedSelect
              value={tiktokPrivacy}
              onChange={(value) => setTikTokPrivacy((value || "") as TikTokPrivacyLevel | "")}
              options={privacyOptions}
              placeholder="Select privacy"
              disabled={isPublishing || !tiktokCreator}
            />
            {selfOnlyOptionDisabled ? (
              <Text mt={1} fontSize="xs" color={theme.text.muted}>
                {TIKTOK_BRANDED_PRIVATE_HINT}
              </Text>
            ) : null}
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Allow interactions
            </Text>
            <VStack align="stretch" gap={2}>
              <ThemedCheckbox
                checked={allowComment}
                onCheckedChange={setAllowComment}
                disabled={isPublishing || Boolean(tiktokCreator?.commentDisabled)}
              >
                Allow Comment
              </ThemedCheckbox>
              <ThemedCheckbox
                checked={allowDuet}
                onCheckedChange={setAllowDuet}
                disabled={isPublishing || Boolean(tiktokCreator?.duetDisabled)}
              >
                Allow Duet
              </ThemedCheckbox>
              <ThemedCheckbox
                checked={allowStitch}
                onCheckedChange={setAllowStitch}
                disabled={isPublishing || Boolean(tiktokCreator?.stitchDisabled)}
              >
                Allow Stitch
              </ThemedCheckbox>
            </VStack>
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              AI-generated content
            </Text>
            <ThemedCheckbox
              checked={isAigc}
              onCheckedChange={setIsAigc}
              disabled={isPublishing}
            >
              This content is AI-generated
            </ThemedCheckbox>
          </Box>

          <ClipperSocialPublishTikTokCommercial
            isPublishing={isPublishing}
            privacyLevel={tiktokPrivacy}
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
          <ThemedCheckbox
            checked={musicUsageConfirmed}
            onCheckedChange={setMusicUsageConfirmed}
            disabled={isPublishing}
          >
            {tiktokConsentCopy(brandContent)}
          </ThemedCheckbox>
        </VStack>
      </VStack>
    </ClipperSocialPublishTwoColumn>
  );
}
