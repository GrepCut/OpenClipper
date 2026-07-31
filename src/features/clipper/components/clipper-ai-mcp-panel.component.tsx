import React from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export interface ClipperAiMcpPanelProps {
  clipCount: number;
  projectId: string;
}

/** Bottom status strip for MCP-driven AI clips (no in-app chat). */
export const ClipperAiMcpPanel: React.FC<ClipperAiMcpPanelProps> = ({
  clipCount,
  projectId,
}) => {
  const { theme } = useClipperUi();
  const navigate = useNavigate();

  return (
    <Box
      flexShrink={0}
      px={4}
      py={3}
      borderTop="1px solid"
      borderColor={theme.border.primary}
    >
      <VStack align="stretch" gap={1.5}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Controlled by MCP
        </Text>
        <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
          {clipCount > 0
            ? `${clipCount} AI clip${clipCount === 1 ? "" : "s"} — updates live (~0.5s) when an agent calls patch_ai_clips.`
            : "Ask your MCP agent to call get_project_transcript, then patch_ai_clips. No login required."}
        </Text>
        <Text fontSize="xs" color={theme.text.muted} fontFamily="mono">
          projectId: {projectId}
        </Text>
        <Box
          as="button"
          type="button"
          alignSelf="start"
          fontSize="sm"
          color={clipperTheme.accentLight}
          cursor="pointer"
          onClick={() => navigate("/clipper?tab=mcp")}
          _hover={{ textDecoration: "underline" }}
        >
          Open MCP setup
        </Box>
      </VStack>
    </Box>
  );
};

export const ClipperAiMcpEmptyState: React.FC = () => {
  const { theme } = useClipperUi();
  return (
    <Box
      flex="1"
      minH={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      px={6}
    >
      <VStack gap={4} textAlign="center" maxW="360px">
        <Box color={clipperTheme.accentLight} opacity={0.9}>
          <Sparkles size={52} />
        </Box>
        <VStack gap={1.5}>
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            No AI clips yet
          </Text>
          <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
            Generate clips from your MCP client (Cursor, etc.) — this panel reacts within half a
            second. No chat, no account.
          </Text>
        </VStack>
      </VStack>
    </Box>
  );
};
