import React, { useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import {
  CLIPPER_CAPTION_PRESETS,
  type CaptionPresetDefinition,
} from "../../lib/captions/caption-presets.util";
import type { ClipperCaptionSettings } from "../../settings/settings.util";
import { clipperTheme } from "../../shared/theme.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { CaptionPresetPreview } from "./caption-preset-preview.component";

interface CaptionsSectionProps {
  captions: ClipperCaptionSettings;
  onChange: (patch: Partial<ClipperCaptionSettings>) => void;
}

interface CaptionPresetRowProps {
  preset?: CaptionPresetDefinition;
  selected: boolean;
  onSelect: () => void;
}

function CaptionPresetRow({
  preset,
  selected,
  onSelect,
}: CaptionPresetRowProps) {
  const { theme } = useClipperUi();
  const [previewActive, setPreviewActive] = useState(false);
  const label = preset?.label ?? "None";

  return (
    <Box
      as="button"
      aria-pressed={selected}
      aria-label={preset ? `Use ${label} caption preset` : "Disable captions"}
      w="full"
      minH={{ base: "52px", md: "56px" }}
      display="flex"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      borderRadius="xl"
      border="1px solid"
      borderColor={
        selected ? clipperTheme.settingSelectedBorder : theme.border.primary
      }
      bg={selected ? theme.brand.toggleActiveBg : theme.background.tertiary}
      boxShadow={
        selected
          ? `0 0 0 1px ${clipperTheme.settingSelectedBorder}, 0 8px 20px rgba(0, 0, 0, 0.2)`
          : "0 6px 16px rgba(0, 0, 0, 0.16)"
      }
      cursor="pointer"
      onPointerEnter={() => setPreviewActive(true)}
      onPointerLeave={() => setPreviewActive(false)}
      onFocus={() => setPreviewActive(true)}
      onBlur={() => setPreviewActive(false)}
      transition="border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease"
      onClick={onSelect}
      _hover={{
        borderColor: selected
          ? clipperTheme.settingSelectedBorder
          : theme.surface.elevated,
        bg: selected ? theme.brand.toggleActiveHoverBg : theme.surface.hover,
        transform: "translateY(-1px)",
      }}
      _active={{ transform: "translateY(0) scale(0.99)" }}
      _focusVisible={{
        outline: `2px solid ${clipperTheme.accentLight}`,
        outlineOffset: "3px",
      }}
    >
      {preset ? (
        <CaptionPresetPreview
          presetId={preset.id}
          compact
          animate={selected || previewActive}
        />
      ) : (
        <Text
          px={6}
          fontSize={{ base: "xl", md: "2xl" }}
          fontWeight="500"
          color={selected ? theme.text.primary : theme.text.onBrandMuted}
          textAlign="center"
          lineClamp={1}
        >
          {label}
        </Text>
      )}
    </Box>
  );
}

export const CaptionsSection: React.FC<CaptionsSectionProps> = ({
  captions,
  onChange,
}) => {
  return (
    <VStack align="stretch" gap={2}>
      <CaptionPresetRow
        selected={!captions.enabled}
        onSelect={() => onChange({ enabled: false })}
      />
      {CLIPPER_CAPTION_PRESETS.map((preset) => (
        <CaptionPresetRow
          key={preset.id}
          preset={preset}
          selected={captions.enabled && captions.presetId === preset.id}
          onSelect={() => onChange({ enabled: true, presetId: preset.id })}
        />
      ))}
    </VStack>
  );
};
