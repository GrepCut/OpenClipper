import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowRight, Trash2 } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { colors, useTheme } from "../../../theme";
import { resolveClipCohorts } from "../benchmark/cohort-tags.util";
import { formatShortDate } from "../../../shared/utils/time.util";
import type { TestClip } from "../test.types";

interface TestClipListRowProps {
  clip: TestClip;
  isAnnotated: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onEditCohorts?: () => void;
}

export function TestClipListRow({
  clip,
  isAnnotated,
  onOpen,
  onDelete,
  onEditCohorts,
}: TestClipListRowProps) {
  const cohorts = resolveClipCohorts(clip);
  const { theme, mode } = useTheme();
  const rowBg = mode === "dark" ? theme.background.card : "gray.50";

  return (
    <Box bg={rowBg} borderRadius="2xl" p={{ base: 4, md: 5 }}>
      <HStack
        align={{ base: "stretch", md: "center" }}
        justify="space-between"
        gap={4}
        flexWrap={{ base: "wrap", lg: "nowrap" }}
      >
        <VStack align="start" gap={2} flex="1" minW={0}>
          <SecondaryMainTitle
            fontSize={{ base: "md", md: "lg" }}
            color={theme.text.primary}
            lineClamp={1}
          >
            {clip.name}
          </SecondaryMainTitle>

          <HStack gap={2} flexWrap="wrap">
            <Box
              px={2}
              py={0.5}
              borderRadius="full"
              bg={
                isAnnotated
                  ? mode === "dark"
                    ? theme.brand.purpleSoftAlpha12
                    : theme.brand.toggleActiveBg
                  : mode === "dark"
                    ? theme.background.secondary
                    : theme.background.tertiary
              }
              color={isAnnotated ? colors.purple.medium : theme.text.muted}
              fontSize="xs"
              fontWeight="semibold"
            >
              {isAnnotated ? "Annotated" : "Draft"}
            </Box>
            <Text fontSize="xs" color={theme.text.muted}>
              {clip.duration.toFixed(1)} s · {clip.width}×{clip.height}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              {cohorts.join(", ")}
            </Text>
          </HStack>
        </VStack>

        <VStack
          align="stretch"
          gap={3}
          flexShrink={0}
          w={{ base: "full", md: "148px" }}
        >
          <Text fontSize="sm" color={theme.text.muted} whiteSpace="nowrap" textAlign="right">
            {formatShortDate(clip.updatedAt)}
          </Text>

          <VStack align="stretch" gap={2}>
            <OutlinedActionButton
              width="100%"
              justifyContent="flex-start"
              startIcon={<ArrowRight size={16} />}
              onClick={onOpen}
            >
              Open
            </OutlinedActionButton>
            {onEditCohorts ? (
              <OutlinedActionButton width="100%" justifyContent="flex-start" onClick={onEditCohorts}>
                Cohorts
              </OutlinedActionButton>
            ) : null}
            <OutlinedActionButton
              width="100%"
              justifyContent="flex-start"
              tone="danger"
              startIcon={<Trash2 size={16} />}
              onClick={onDelete}
            >
              Delete
            </OutlinedActionButton>
          </VStack>
        </VStack>
      </HStack>
    </Box>
  );
}
