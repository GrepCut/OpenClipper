import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { useTheme } from "../../../theme";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import type { ClipperOwnerRecord } from "../persistence/clipper-owner-db-api.util";
import { formatShortDate } from "../../../shared/utils/time.util";

interface ClipperOwnerListRowProps {
  owner: ClipperOwnerRecord;
  onOpen: () => void;
}

export function ClipperOwnerListRow({ owner, onOpen }: ClipperOwnerListRowProps) {
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
            {owner.name}
          </SecondaryMainTitle>
          <Text fontSize="xs" color={theme.text.muted}>
            {owner.projectCount} projects · {owner.channelCount} channels
          </Text>
        </VStack>

        <VStack
          align="stretch"
          gap={3}
          flexShrink={0}
          w={{ base: "full", md: "148px" }}
        >
          <Text fontSize="sm" color={theme.text.muted} whiteSpace="nowrap" textAlign="right">
            {formatShortDate(owner.updatedAt)}
          </Text>
          <OutlinedActionButton
            width="100%"
            justifyContent="flex-start"
            startIcon={<ArrowRight size={16} />}
            onClick={onOpen}
          >
            Open
          </OutlinedActionButton>
        </VStack>
      </HStack>
    </Box>
  );
}
