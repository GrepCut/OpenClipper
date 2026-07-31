import React from "react";
import { Flex } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export type ClipperHomeTab = "projects" | "integrations" | "publish" | "owners" | "settings";

const OPTIONS: Array<{ value: ClipperHomeTab; label: string }> = [
  { value: "projects", label: "Projects" },
  { value: "integrations", label: "Integrations" },
  { value: "publish", label: "Publish" },
  { value: "owners", label: "Owners" },
  { value: "settings", label: "Settings" },
];

interface ClipperHomeNavToggleProps {
  value: ClipperHomeTab;
  onChange: (value: ClipperHomeTab) => void;
  disabled?: boolean;
}

export const ClipperHomeNavToggle: React.FC<ClipperHomeNavToggleProps> = ({
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
            aria-disabled={disabled || undefined}
            aria-pressed={isActive}
            onClick={() => {
              if (disabled) return;
              onChange(option.value);
            }}
            align="center"
            justify="center"
            px={3}
            py={1}
            borderRadius="full"
            fontSize="xs"
            fontWeight={isActive ? "700" : "600"}
            letterSpacing="-0.01em"
            color={isActive ? "white" : theme.text.muted}
            bg={isActive ? accent : "transparent"}
            cursor={disabled ? "not-allowed" : "pointer"}
            pointerEvents={disabled ? "none" : undefined}
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
