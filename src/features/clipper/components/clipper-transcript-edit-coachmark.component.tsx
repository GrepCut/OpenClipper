import React from "react";
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export interface ClipperTranscriptEditCoachmarkProps {
  onDismiss: () => void;
}

const ALERT_ORANGE_RGB = "251,146,60";

const TIPS = [
  "Double-click a word to fix its spelling.",
  "Drag over words to select them, then hide them from the captions or edit them together.",
] as const;

/** One-time callout above the clip list that introduces transcript editing. */
export function ClipperTranscriptEditCoachmark({
  onDismiss,
}: ClipperTranscriptEditCoachmarkProps) {
  const { theme } = useClipperUi();

  return (
    <Box px={5} pt={3} pb={4}>
      <HStack
        role="note"
        align="flex-start"
        gap={3}
        px={4}
        py={4}
        borderRadius="2xl"
        border="1px solid"
        borderColor={`rgba(${ALERT_ORANGE_RGB},0.45)`}
        bg={`rgba(${ALERT_ORANGE_RGB},0.12)`}
      >
        <VStack align="stretch" gap={3} flex={1} minW={0}>
          <VStack align="stretch" gap={1.5}>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} lineHeight="1.2">
              Transcript not perfect?
            </Text>
            <VStack align="stretch" gap={1}>
              {TIPS.map((tip, index) => (
                <Text key={tip} fontSize="xs" color={theme.text.primary} lineHeight="1.5">
                  {index + 1}. {tip}
                </Text>
              ))}
            </VStack>
          </VStack>
          <HStack gap={2}>
            <OutlinedActionButton
              onClick={onDismiss}
              color="white"
              bg="#E53E3E"
              borderColor="#E53E3E"
              _hover={{ bg: "#C53030", borderColor: "#C53030" }}
            >
              Got it
            </OutlinedActionButton>
          </HStack>
        </VStack>
        <Button
          aria-label="Dismiss"
          size="2xs"
          variant="ghost"
          minW={0}
          h="auto"
          p={1}
          mt="-4px"
          mr="-4px"
          color={theme.text.muted}
          _hover={{ bg: "transparent", color: theme.text.primary }}
          onClick={onDismiss}
        >
          <X size={14} />
        </Button>
      </HStack>
    </Box>
  );
}
