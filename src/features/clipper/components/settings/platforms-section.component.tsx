import React from "react";
import { Input, Text, VStack } from "@chakra-ui/react";
import type { ClipperFormatSettings, ClipperQualityPreset, ClipperResolutionCap } from "../../settings/settings.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingSection } from "./setting-controls.component";

interface PlatformsSectionProps {
  formats: ClipperFormatSettings;
  onChange: (patch: Partial<ClipperFormatSettings>) => void;
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

export const PlatformsSection: React.FC<PlatformsSectionProps> = ({ formats, onChange }) => {
  const { theme } = useClipperUi();

  return (
    <SettingSection title="Export" description="Quality and filename options" defaultOpen>
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

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Filename template
        </Text>
        <Input
          value={formats.filenameTemplate}
          onChange={(e) => onChange({ filenameTemplate: e.target.value })}
          size="sm"
          borderRadius="lg"
          bg={theme.surface.subtle}
          borderColor={theme.surface.borderStrong}
          color={theme.text.primary}
        />
        <Text fontSize="xs" color={theme.text.toggleThumbInactive}>
          Use {"{name}"} and {"{platform}"} — e.g. {"{name}-{platform}"}
        </Text>
      </VStack>
    </SettingSection>
  );
};
