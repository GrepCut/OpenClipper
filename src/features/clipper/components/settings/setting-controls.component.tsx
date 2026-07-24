import React, { useState } from "react";
import { Box, Button, HStack, Slider, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { clipperTheme } from "../../shared/theme.util";

interface SettingSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const SettingSection: React.FC<SettingSectionProps> = ({
  title,
  description,
  defaultOpen = false,
  children,
}) => {
  const { theme } = useClipperUi();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box
      borderBottom="1px solid"
      borderColor={theme.border.primary}
      _last={{ borderBottom: "none" }}
    >
      <Box
        as="button"
        w="full"
        px={1}
        py={3.5}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        cursor="pointer"
        onClick={() => setOpen((v) => !v)}
        _hover={{
          "& [data-section-title]": { color: clipperTheme.accentLight },
          "& [data-section-chevron]": { color: clipperTheme.accentLight },
        }}
      >
        <VStack align="start" gap={0}>
          <Text
            data-section-title
            fontSize="sm"
            fontWeight="semibold"
            color={open ? clipperTheme.accentLight : theme.text.primary}
            transition="color 0.15s ease"
          >
            {title}
          </Text>
          {description && (
            <Text fontSize="xs" color={theme.text.muted}>
              {description}
            </Text>
          )}
        </VStack>
        <Box
          data-section-chevron
          color={theme.text.muted}
          transform={open ? "rotate(180deg)" : "rotate(0deg)"}
          transition="transform 0.15s ease, color 0.15s ease"
        >
          <ChevronDown size={18} />
        </Box>
      </Box>
      {open && (
        <VStack align="stretch" gap={4} px={1} pb={4}>
          {children}
        </VStack>
      )}
    </Box>
  );
};

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  const { theme } = useClipperUi();

  return (
    <HStack gap={2} flexWrap="wrap">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Button
            key={opt.value}
            size="sm"
            variant={active ? "solid" : "outline"}
            bg={active ? clipperTheme.accent : "transparent"}
            borderColor={theme.surface.elevated}
            color={active ? theme.text.onBrand : theme.brand.purpleText}
            borderRadius="lg"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            _hover={{ bg: active ? clipperTheme.accentHover : `rgba(${clipperTheme.accentTintRgb},0.14)` }}
          >
            {opt.label}
          </Button>
        );
      })}
    </HStack>
  );
}

interface SettingRowProps {
  label: string;
  hint?: string;
  control: React.ReactNode;
}

export const SettingRow: React.FC<SettingRowProps> = ({ label, hint, control }) => {
  const { theme } = useClipperUi();

  return (
    <HStack justify="space-between" gap={4} align="center">
      <VStack align="start" gap={0}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          {label}
        </Text>
        {hint && (
          <Text fontSize="xs" color={theme.text.toggleThumbInactive}>
            {hint}
          </Text>
        )}
      </VStack>
      {control}
    </HStack>
  );
};

interface SettingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  valueLabel?: string;
  onChange: (value: number) => void;
}

export const SettingSlider: React.FC<SettingSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  valueLabel,
  onChange,
}) => {
  const { theme } = useClipperUi();

  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between">
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          {label}
        </Text>
        <Text fontSize="xs" color={clipperTheme.accentLight}>
          {valueLabel ?? value}
        </Text>
      </HStack>
      <Slider.Root min={min} max={max} step={step} value={[value]} onValueChange={(d) => onChange(d.value[0] ?? value)}>
        <Slider.Control>
          <Slider.Track bg={theme.surface.active} borderRadius="full">
            <Slider.Range bg={clipperTheme.accent} />
          </Slider.Track>
          <Slider.Thumb index={0} />
        </Slider.Control>
      </Slider.Root>
    </VStack>
  );
};
