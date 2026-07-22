import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";
import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "../../../services/social-auth.service";

interface ClipperSocialPublishTikTokFormProps {
  result: ClipperFormatResult | null;
  isPublishing: boolean;
  tiktokCreator: TikTokCreatorInfo | null;
  tiktokError: string | null;
  tiktokPrivacy: TikTokPrivacyLevel | "";
  setTikTokPrivacy: (value: TikTokPrivacyLevel) => void;
  allowComment: boolean;
  setAllowComment: React.Dispatch<React.SetStateAction<boolean>>;
  allowDuet: boolean;
  setAllowDuet: React.Dispatch<React.SetStateAction<boolean>>;
  allowStitch: boolean;
  setAllowStitch: React.Dispatch<React.SetStateAction<boolean>>;
  isAigc: boolean;
  setIsAigc: React.Dispatch<React.SetStateAction<boolean>>;
  brandContent: boolean;
  setBrandContent: React.Dispatch<React.SetStateAction<boolean>>;
  brandOrganic: boolean;
  setBrandOrganic: React.Dispatch<React.SetStateAction<boolean>>;
  musicUsageConfirmed: boolean;
  setMusicUsageConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ClipperSocialPublishTikTokForm({
  result,
  isPublishing,
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
  brandContent,
  setBrandContent,
  brandOrganic,
  setBrandOrganic,
  musicUsageConfirmed,
  setMusicUsageConfirmed,
}: ClipperSocialPublishTikTokFormProps) {
  const { theme } = useClipperUi();

  return (
    <VStack align="stretch" gap={3}>
      <Box p={3} borderRadius="xl" bg={theme.surface.subtle}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          {tiktokCreator?.nickname || "TikTok account"}
        </Text>
        <Text fontSize="xs" color={theme.text.muted}>
          {tiktokCreator?.username ? `@${tiktokCreator.username}` : "Loading current TikTok posting settings…"}
        </Text>
        {tiktokError || (!tiktokCreator?.canPost && tiktokCreator?.blockerMessage) ? (
          <Text mt={2} fontSize="xs" color={theme.status.error}>
            {tiktokError || tiktokCreator?.blockerMessage}
          </Text>
        ) : null}
      </Box>

      {result?.previewUrl ? (
        <video controls src={result.previewUrl} style={{ width: "100%", borderRadius: "12px" }} />
      ) : null}

      <Box>
        <Text fontSize="sm" mb={2} color={theme.text.distinct}>Privacy (required)</Text>
        <HStack gap={2} flexWrap="wrap">
          {(tiktokCreator?.privacyLevelOptions ?? []).map((option) => (
            <Button key={option} size="sm" variant={tiktokPrivacy === option ? "solid" : "outline"}
              onClick={() => setTikTokPrivacy(option)} disabled={isPublishing}>
              {option.replaceAll("_", " ")}
            </Button>
          ))}
        </HStack>
      </Box>

      <Box>
        <Text fontSize="sm" mb={2} color={theme.text.distinct}>Allow interactions</Text>
        <HStack gap={2} flexWrap="wrap">
          <Button size="sm" variant={allowComment ? "solid" : "outline"} onClick={() => setAllowComment((v) => !v)} disabled={isPublishing || Boolean(tiktokCreator?.commentDisabled)}>Comments</Button>
          <Button size="sm" variant={allowDuet ? "solid" : "outline"} onClick={() => setAllowDuet((v) => !v)} disabled={isPublishing || Boolean(tiktokCreator?.duetDisabled)}>Duet</Button>
          <Button size="sm" variant={allowStitch ? "solid" : "outline"} onClick={() => setAllowStitch((v) => !v)} disabled={isPublishing || Boolean(tiktokCreator?.stitchDisabled)}>Stitch</Button>
        </HStack>
      </Box>

      <Box>
        <Text fontSize="sm" mb={2} color={theme.text.distinct}>Content declarations</Text>
        <HStack gap={2} flexWrap="wrap">
          <Button size="sm" variant={isAigc ? "solid" : "outline"} onClick={() => setIsAigc((v) => !v)} disabled={isPublishing}>AI-generated content</Button>
          <Button size="sm" variant={brandContent ? "solid" : "outline"} onClick={() => setBrandContent((v) => !v)} disabled={isPublishing}>Branded content</Button>
          <Button size="sm" variant={brandOrganic ? "solid" : "outline"} onClick={() => setBrandOrganic((v) => !v)} disabled={isPublishing}>Your brand</Button>
        </HStack>
      </Box>

      <Button size="sm" variant={musicUsageConfirmed ? "solid" : "outline"}
        onClick={() => setMusicUsageConfirmed((v) => !v)} disabled={isPublishing}>
        By posting, I agree to TikTok&apos;s Music Usage Confirmation
      </Button>
    </VStack>
  );
}
