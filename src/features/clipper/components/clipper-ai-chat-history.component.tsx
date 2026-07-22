import React from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import type { ClipperAiChatMessage } from "../persistence/ai-clip-api.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

interface ClipperAiChatHistoryProps {
  messages: ClipperAiChatMessage[];
}

export const ClipperAiChatHistory: React.FC<ClipperAiChatHistoryProps> = ({ messages }) => {
  const { theme } = useClipperUi();

  if (messages.length === 0) {
    return (
      <Box px={4} py={8} textAlign="center">
        <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
          No messages yet. Ask the model to generate clips and the conversation will appear here.
        </Text>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={3} px={3} py={2} pb={4}>
      {messages.map((message) => {
        const isUser = message.role === "user";
        const clipCount = message.clipsSnapshot?.clips?.length ?? 0;

        return (
          <Box
            key={message.id}
            alignSelf={isUser ? "flex-end" : "flex-start"}
            maxW="92%"
            px={3}
            py={2.5}
            borderRadius="xl"
            bg={isUser ? `rgba(${clipperTheme.accentTintRgb}, 0.16)` : theme.surface.subtle}
            border="1px solid"
            borderColor={isUser ? `rgba(${clipperTheme.accentTintRgb}, 0.35)` : theme.border.primary}
          >
            <Text
              fontSize="10px"
              fontWeight="700"
              color={isUser ? clipperTheme.accentLight : theme.text.muted}
              letterSpacing="0.04em"
              textTransform="uppercase"
              mb={1}
            >
              {isUser ? "You" : "Assistant"}
            </Text>
            <Text
              fontSize="sm"
              color={theme.text.primary}
              lineHeight="1.5"
              whiteSpace="pre-wrap"
            >
              {message.content}
            </Text>
            {!isUser && clipCount > 0 ? (
              <Text fontSize="xs" color={clipperTheme.accentLight} mt={2} fontWeight="medium">
                Generated {clipCount} clip{clipCount > 1 ? "s" : ""}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </VStack>
  );
};
