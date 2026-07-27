import React from "react";
import { HStack, Text, VStack } from "@chakra-ui/react";
import type { ClipperFormatSettings, ClipperQualityPreset, ClipperResolutionCap } from "../../settings/settings.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingSection } from "./setting-controls.component";

interface ExportFormatControlsProps {
  formats: ClipperFormatSettings;
  onChange: (patch: Partial<ClipperFormatSettings>) => void;
  /** Stacked (drawer) vs compact wrap (render queue bar). */
  layout?: "stack" | "bar";
}

const QUALITY_OPTIONS: { value: ClipperQualityPreset; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

const RESOLUTION_OPTIONS: { value: ClipperResolutionCap; label: string }[] = [
  { value: "source", label: "Source" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
];

export const ExportFormatControls: React.FC<ExportFormatControlsProps> = ({
  formats,
  onChange,
  layout = "stack",
}) => {
  const { theme } = useClipperUi();

  if (layout === "bar") {
    return (
      <HStack gap={4} flexWrap="wrap" align="flex-end">
        <VStack align="stretch" gap={1.5} minW="160px">
          <Text fontSize="xs" color={theme.text.onBrandMuted}>
            Quality
          </Text>
          <SegmentedControl
            options={QUALITY_OPTIONS}
            value={formats.quality}
            onChange={(v) => onChange({ quality: v })}
          />
        </VStack>
        <VStack align="stretch" gap={1.5} minW="180px">
          <Text fontSize="xs" color={theme.text.onBrandMuted}>
            Resolution cap
          </Text>
          <SegmentedControl
            options={RESOLUTION_OPTIONS}
            value={formats.resolutionCap}
            onChange={(v) => onChange({ resolutionCap: v })}
          />
        </VStack>
      </HStack>
    );
  }

  return (
    <VStack align="stretch" gap={4}>
      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Quality
        </Text>
        <SegmentedControl options={QUALITY_OPTIONS} value={formats.quality} onChange={(v) => onChange({ quality: v })} />
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Resolution cap
        </Text>
        <SegmentedControl
          options={RESOLUTION_OPTIONS}
          value={formats.resolutionCap}
          onChange={(v) => onChange({ resolutionCap: v })}
        />
      </VStack>
    </VStack>
  );
};

interface PlatformsSectionProps {
  formats: ClipperFormatSettings;
  onChange: (patch: Partial<ClipperFormatSettings>) => void;
}

export const PlatformsSection: React.FC<PlatformsSectionProps> = ({ formats, onChange }) => {
  return (
    <SettingSection title="Export" description="Quality and resolution options" defaultOpen>
      <ExportFormatControls formats={formats} onChange={onChange} layout="stack" />
    </SettingSection>
  );
};
