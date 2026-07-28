import React, { useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  CLIPPER_CAPTION_PRESETS,
  type CaptionPresetDefinition,
} from "../../lib/captions/caption-presets.util";
import type {
  ClipperCaptionPosition,
  ClipperCaptionSettings,
  ClipperCaptionSize,
} from "../../settings/settings.util";
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

const POSITION_OPTIONS: {
  value: ClipperCaptionPosition;
  label: string;
  lineY: number;
}[] = [
  { value: "top", label: "Top", lineY: 23 },
  { value: "center", label: "Center", lineY: 48 },
  { value: "bottom", label: "Bottom", lineY: 73 },
];

const SIZE_OPTIONS: {
  value: ClipperCaptionSize;
  label: string;
  fontSize: number;
}[] = [
  { value: "small", label: "Small", fontSize: 18 },
  { value: "medium", label: "Medium", fontSize: 26 },
  { value: "large", label: "Large", fontSize: 36 },
];

const WORD_AMOUNT_OPTIONS = [1, 2, 3, 4, 5] as const;

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
      h={{ base: "52px", md: "56px" }}
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      borderRadius="2xl"
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
        outlineOffset: "2px",
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { theme } = useClipperUi();

  return (
    <Text
      fontSize="sm"
      fontWeight="semibold"
      color={theme.text.primary}
      letterSpacing="0.01em"
    >
      {children}
    </Text>
  );
}

function PositionPreview({
  lineY,
  selected,
}: {
  lineY: number;
  selected: boolean;
}) {
  const { theme } = useClipperUi();
  const accent = selected ? clipperTheme.accentLight : theme.text.muted;

  return (
    <svg
      viewBox="0 0 54 96"
      width="42"
      height="75"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect
        x="1"
        y="1"
        width="52"
        height="94"
        rx="8"
        fill={theme.background.tertiary}
        stroke={selected ? clipperTheme.settingSelectedBorder : theme.border.primary}
        strokeWidth="2"
      />
      <rect x="7" y="8" width="40" height="80" rx="4" fill={theme.surface.active} />
      <rect
        x="12"
        y={lineY - 4}
        width="30"
        height="8"
        rx="4"
        fill={accent}
      />
      <rect
        x="17"
        y={lineY - 1}
        width="20"
        height="2"
        rx="1"
        fill={theme.background.primary}
        opacity="0.75"
      />
    </svg>
  );
}

function SizePreview({
  fontSize,
  selected,
}: {
  fontSize: number;
  selected: boolean;
}) {
  const { theme } = useClipperUi();

  return (
    <Box
      h="75px"
      w="full"
      display="flex"
      alignItems="center"
      justifyContent="center"
      aria-hidden="true"
    >
      <Text
        color={selected ? clipperTheme.accentLight : theme.text.onBrandMuted}
        fontFamily="Inter, sans-serif"
        fontSize={`${fontSize}px`}
        fontWeight="800"
        lineHeight="1"
        transition="font-size 160ms ease, color 160ms ease"
      >
        Aa
      </Text>
    </Box>
  );
}

interface VisualOptionButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function VisualOptionButton({
  active,
  label,
  onClick,
  children,
}: VisualOptionButtonProps) {
  const { theme } = useClipperUi();

  return (
    <Box
      as="button"
      aria-pressed={active}
      aria-label={label}
      flex="1"
      minW={0}
      py={2}
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap={1.5}
      borderRadius="2xl"
      border="1px solid"
      borderColor={active ? clipperTheme.settingSelectedBorder : theme.border.primary}
      bg={active ? theme.brand.toggleActiveBg : theme.background.tertiary}
      color={active ? clipperTheme.accentLight : theme.text.onBrandMuted}
      cursor="pointer"
      transition="border-color 160ms ease, background 160ms ease, transform 160ms ease"
      onClick={onClick}
      _hover={{
        borderColor: clipperTheme.settingSelectedBorder,
        bg: active ? theme.brand.toggleActiveHoverBg : theme.surface.hover,
        transform: "translateY(-1px)",
      }}
      _active={{ transform: "translateY(0) scale(0.98)" }}
      _focusVisible={{
        outline: `2px solid ${clipperTheme.accentLight}`,
        outlineOffset: "2px",
      }}
    >
      {children}
      <Text fontSize="xs" fontWeight={active ? "semibold" : "medium"}>
        {label}
      </Text>
    </Box>
  );
}

export const CaptionsSection: React.FC<CaptionsSectionProps> = ({
  captions,
  onChange,
}) => {
  const { theme, scrollbarCss } = useClipperUi();

  return (
    <VStack align="stretch" gap={5}>
      <VStack align="stretch" gap={2}>
        <SectionLabel>Presets</SectionLabel>
        <Box position="relative">
          <VStack
            align="stretch"
            gap={2}
            maxH={{ base: "232px", md: "248px" }}
            overflowY="auto"
            overscrollBehavior="contain"
            pr={2}
            role="group"
            aria-label="Caption presets"
            css={scrollbarCss}
          >
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
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right="10px"
            h="42px"
            pointerEvents="none"
            bg={`linear-gradient(to top, ${theme.background.primary} 0%, transparent 100%)`}
          />
        </Box>
      </VStack>

      <VStack align="stretch" gap={2}>
        <SectionLabel>Position</SectionLabel>
        <HStack gap={2} align="stretch" role="group" aria-label="Caption position">
          {POSITION_OPTIONS.map((option) => (
            <VisualOptionButton
              key={option.value}
              active={captions.position === option.value}
              label={option.label}
              onClick={() => onChange({ position: option.value })}
            >
              <PositionPreview
                lineY={option.lineY}
                selected={captions.position === option.value}
              />
            </VisualOptionButton>
          ))}
        </HStack>
      </VStack>

      <VStack align="stretch" gap={2}>
        <SectionLabel>Size</SectionLabel>
        <HStack gap={2} align="stretch" role="group" aria-label="Caption size">
          {SIZE_OPTIONS.map((option) => (
            <VisualOptionButton
              key={option.value}
              active={captions.size === option.value}
              label={option.label}
              onClick={() => onChange({ size: option.value })}
            >
              <SizePreview
                fontSize={option.fontSize}
                selected={captions.size === option.value}
              />
            </VisualOptionButton>
          ))}
        </HStack>
      </VStack>

      <VStack align="stretch" gap={2}>
        <SectionLabel>Word amount</SectionLabel>
        <HStack gap={2} role="group" aria-label="Words per caption">
          {WORD_AMOUNT_OPTIONS.map((amount) => {
            const active = captions.wordsPerGroup === amount;
            return (
              <Box
                key={amount}
                as="button"
                aria-pressed={active}
                aria-label={`${amount} ${amount === 1 ? "word" : "words"} per caption`}
                flex="1"
                minW={0}
                h="42px"
                borderRadius="2xl"
                border="1px solid"
                borderColor={
                  active ? clipperTheme.settingSelectedBorder : "transparent"
                }
                bg={
                  active
                    ? `rgba(${clipperTheme.accentTintRgb}, 0.24)`
                    : `rgba(${clipperTheme.accentTintRgb}, 0.08)`
                }
                color={active ? clipperTheme.accentLight : "inherit"}
                fontSize="sm"
                fontWeight="semibold"
                cursor="pointer"
                onClick={() => onChange({ wordsPerGroup: amount })}
                transition="background 160ms ease, border-color 160ms ease, transform 160ms ease"
                _hover={{
                  bg: `rgba(${clipperTheme.accentTintRgb}, 0.18)`,
                  borderColor: clipperTheme.settingSelectedBorder,
                }}
                _active={{ transform: "scale(0.96)" }}
                _focusVisible={{
                  outline: `2px solid ${clipperTheme.accentLight}`,
                  outlineOffset: "2px",
                }}
              >
                {amount}
              </Box>
            );
          })}
        </HStack>
      </VStack>
    </VStack>
  );
};
