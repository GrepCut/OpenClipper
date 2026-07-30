import { Box, HStack, Input, Text, VStack, useBreakpointValue } from "@chakra-ui/react";
import {
  getOutlinedActionSurfaceProps,
  OutlinedActionButton,
  OUTLINED_ACTION_BUTTON_SIZE_PROPS,
} from "../../../shared/components/buttons/outlined-action-button.component";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";
import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "../../../services/social-auth.service";

interface ClipperSocialPublishTikTokFormProps {
  result: ClipperFormatResult | null;
  isPublishing: boolean;
  title: string;
  setTitle: (value: string) => void;
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

const TOGGLE_BUTTON_PROPS = {
  ...OUTLINED_ACTION_BUTTON_SIZE_PROPS,
  h: "36px",
  minH: "36px",
  whiteSpace: "nowrap" as const,
};

function ToggleOptionButton({
  isSelected,
  disabled,
  onClick,
  children,
  ...buttonProps
}: {
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & React.ComponentProps<typeof OutlinedActionButton>) {
  const { theme } = useClipperUi();

  return (
    <OutlinedActionButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isSelected}
      borderRadius="xl"
      color={isSelected ? theme.text.primary : theme.text.muted}
      {...getOutlinedActionSurfaceProps(theme, isSelected)}
      {...TOGGLE_BUTTON_PROPS}
      {...buttonProps}
    >
      {children}
    </OutlinedActionButton>
  );
}

function formatPrivacyLabel(option: TikTokPrivacyLevel) {
  return option.replaceAll("_", " ");
}

const TIKTOK_PREVIEW_HEIGHT = "min(calc(85vh - 9rem), 640px)";

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
  brandContent,
  setBrandContent,
  brandOrganic,
  setBrandOrganic,
  musicUsageConfirmed,
  setMusicUsageConfirmed,
}: ClipperSocialPublishTikTokFormProps) {
  const { theme } = useClipperUi();
  const isLargeLayout = useBreakpointValue({ base: false, lg: true }) ?? false;

  return (
    <HStack
      w="full"
      align="stretch"
      gap={5}
      h={{ base: "auto", lg: TIKTOK_PREVIEW_HEIGHT }}
      minH={0}
      flexDirection={{ base: "column", lg: "row" }}
    >
      {result?.previewUrl ? (
        <video
          controls
          src={result.previewUrl}
          style={{
            ...(isLargeLayout
              ? { height: "100%", width: "auto" }
              : { width: "min(100%, 280px)", height: "auto" }),
            maxWidth: "100%",
            aspectRatio: "9 / 16",
            objectFit: "cover",
            borderRadius: "12px",
            display: "block",
            flexShrink: 0,
            alignSelf: "center",
          }}
        />
      ) : (
        <Box
          flexShrink={0}
          h={{ base: "320px", lg: "100%" }}
          w={{ base: "full", lg: "auto" }}
          maxW={{ base: "280px", lg: "none" }}
          aspectRatio="9 / 16"
          mx={{ base: "auto", lg: 0 }}
          borderRadius="xl"
          bg={theme.surface.subtle}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="sm" color={theme.text.muted}>
            No preview available
          </Text>
        </Box>
      )}

      <VStack
        flex={1}
        minW={0}
        h={{ lg: "100%" }}
        align="stretch"
        gap={2}
        justify="space-between"
      >
        <VStack align="stretch" gap={2} flex={1} minH={0}>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
              {tiktokCreator?.nickname || "TikTok account"}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              {tiktokCreator?.username
                ? `@${tiktokCreator.username}`
                : "Loading current TikTok posting settings…"}
            </Text>
            {tiktokError || (!tiktokCreator?.canPost && tiktokCreator?.blockerMessage) ? (
              <Text mt={1} fontSize="xs" color={theme.status.error}>
                {tiktokError || tiktokCreator?.blockerMessage}
              </Text>
            ) : null}
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Caption
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

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Privacy (required)
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {(tiktokCreator?.privacyLevelOptions ?? []).map((option) => (
                <ToggleOptionButton
                  key={option}
                  isSelected={tiktokPrivacy === option}
                  onClick={() => setTikTokPrivacy(option)}
                  disabled={isPublishing}
                >
                  {formatPrivacyLabel(option)}
                </ToggleOptionButton>
              ))}
            </HStack>
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
                Comments
              </ToggleOptionButton>
              <ToggleOptionButton
                isSelected={allowDuet}
                onClick={() => setAllowDuet((v) => !v)}
                disabled={isPublishing || Boolean(tiktokCreator?.duetDisabled)}
              >
                Duet
              </ToggleOptionButton>
              <ToggleOptionButton
                isSelected={allowStitch}
                onClick={() => setAllowStitch((v) => !v)}
                disabled={isPublishing || Boolean(tiktokCreator?.stitchDisabled)}
              >
                Stitch
              </ToggleOptionButton>
            </HStack>
          </Box>

          <Box>
            <Text fontSize="sm" mb={1.5} color={theme.text.distinct}>
              Content declarations
            </Text>
            <HStack gap={2} flexWrap="wrap">
              <ToggleOptionButton
                isSelected={isAigc}
                onClick={() => setIsAigc((v) => !v)}
                disabled={isPublishing}
              >
                AI-generated content
              </ToggleOptionButton>
              <ToggleOptionButton
                isSelected={brandContent}
                onClick={() => setBrandContent((v) => !v)}
                disabled={isPublishing}
              >
                Branded content
              </ToggleOptionButton>
              <ToggleOptionButton
                isSelected={brandOrganic}
                onClick={() => setBrandOrganic((v) => !v)}
                disabled={isPublishing}
              >
                Your brand
              </ToggleOptionButton>
            </HStack>
          </Box>
        </VStack>

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
          By posting, I agree to TikTok&apos;s Music Usage Confirmation
        </ToggleOptionButton>
      </VStack>
    </HStack>
  );
}
