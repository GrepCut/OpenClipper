import React from "react";
import { Button, HStack } from "@chakra-ui/react";
import type { ManualClipPlaybackMode } from "../hooks/use-clipper-manual-clip-range.hook";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

const MODE_OPTIONS: Array<{ value: ManualClipPlaybackMode; label: string }> = [
  { value: "select", label: "Select" },
  { value: "watch", label: "Watch" },
];

export function ClipperManualClipModeSwitch({
  value,
  onChange,
}: {
  value: ManualClipPlaybackMode;
  onChange: (mode: ManualClipPlaybackMode) => void;
}) {
  const { theme } = useClipperUi();

  return (
    <HStack gap={1.5} flexShrink={0}>
      {MODE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <Button
            key={option.value}
            type="button"
            size="xs"
            h="28px"
            px={3}
            borderRadius="full"
            variant={active ? "solid" : "outline"}
            bg={active ? clipperTheme.accent : "transparent"}
            borderColor={theme.surface.elevated}
            color={active ? theme.text.onBrand : theme.brand.purpleText}
            fontSize="xs"
            fontWeight="semibold"
            onClick={() => onChange(option.value)}
            _hover={{
              bg: active ? clipperTheme.accentHover : `rgba(${clipperTheme.accentTintRgb},0.14)`,
            }}
          >
            {option.label}
          </Button>
        );
      })}
    </HStack>
  );
}
