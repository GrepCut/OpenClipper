import React from "react";
import { Flex } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export type ClipperAiChatPanelView = "clips" | "history";

const OPTIONS: Array<{ value: ClipperAiChatPanelView; label: string }> = [
  { value: "clips", label: "Clip list" },
  { value: "history", label: "History" },
];

interface ClipperAiChatPanelToggleProps {
  value: ClipperAiChatPanelView;
  onChange: (value: ClipperAiChatPanelView) => void;
  disabled?: boolean;
}

export const ClipperAiChatPanelToggle: React.FC<ClipperAiChatPanelToggleProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const { theme } = useClipperUi();
  const accent = clipperTheme.accent;

  return (
    <Flex
      gap={0.5}
      p={0.5}
      borderRadius="full"
      bg={theme.surface.subtle}
      border="1px solid"
      borderColor={theme.border.primary}
      flexShrink={0}
    >
      {OPTIONS.map((option) => {
        const isActive = option.value === value;
        return (
          <Flex
            key={option.value}
            as="button"
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            align="center"
            justify="center"
            px={2.5}
            py={1}
            borderRadius="full"
            fontSize="10px"
            fontWeight={isActive ? "700" : "600"}
            letterSpacing="-0.01em"
            color={isActive ? "white" : theme.text.muted}
            bg={isActive ? accent : "transparent"}
            cursor={disabled ? "not-allowed" : "pointer"}
            transition="all 0.2s ease"
            _hover={
              !isActive && !disabled
                ? { bg: theme.surface.hover, color: theme.text.primary }
                : undefined
            }
            whiteSpace="nowrap"
          >
            {option.label}
          </Flex>
        );
      })}
    </Flex>
  );
};
