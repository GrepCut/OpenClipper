import React from "react";
import { HStack, Input, Text, VStack } from "@chakra-ui/react";
import { ModernSwitch } from "../../../../shared/components/ui/modern-switch.component";
import type { CaptionBoxStyle } from '../../lib/captions/animated-caption-render.util';
import type {
  SubtitleFontFamily,
  SubtitleFontSize,
  SubtitlePosition,
} from '../../lib/captions/subtitle-render.util';
import type { ClipperCaptionSettings } from "../../settings/settings.util";
import { clampWordsPerGroup } from "../../settings/settings.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingRow, SettingSection, SettingSlider } from "./setting-controls.component";

interface CaptionsSectionProps {
  captions: ClipperCaptionSettings;
  enabledFormats: ClipperFormatDef[];
  onChange: (patch: Partial<ClipperCaptionSettings>) => void;
}

const FONT_FAMILY_OPTIONS: { value: SubtitleFontFamily; label: string }[] = [
  { value: "arial", label: "Arial" },
  { value: "system", label: "System" },
];

const FONT_SIZE_OPTIONS: { value: SubtitleFontSize; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
  { value: "xl", label: "XL" },
];

const POSITION_OPTIONS: { value: SubtitlePosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
];

const BOX_STYLE_OPTIONS: { value: CaptionBoxStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "outline", label: "Outline" },
  { value: "none", label: "None" },
];

export const CaptionsSection: React.FC<CaptionsSectionProps> = ({ captions, enabledFormats, onChange }) => {
  const { theme } = useClipperUi();
  const toggleFormatDisabled = (formatId: string) => {
    const disabled = captions.disabledForFormatIds.includes(formatId);
    onChange({
      disabledForFormatIds: disabled
        ? captions.disabledForFormatIds.filter((id) => id !== formatId)
        : [...captions.disabledForFormatIds, formatId],
    });
  };

  return (
    <SettingSection title="Captions" description="Burned-in caption style for every export" defaultOpen>
      <SettingRow
        label="Captions"
        control={<ModernSwitch checked={captions.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />}
      />

      {captions.enabled && (
        <>
          <VStack align="stretch" gap={2}>
            <Text fontSize="sm" color={theme.text.onBrandMuted}>
              Position
            </Text>
            <SegmentedControl
              options={POSITION_OPTIONS}
              value={captions.position}
              onChange={(v) => onChange({ position: v })}
            />
          </VStack>

          <VStack align="stretch" gap={2}>
            <Text fontSize="sm" color={theme.text.onBrandMuted}>
              Font family
            </Text>
            <SegmentedControl
              options={FONT_FAMILY_OPTIONS}
              value={captions.fontFamily}
              onChange={(v) => onChange({ fontFamily: v })}
            />
          </VStack>

          <VStack align="stretch" gap={2}>
            <Text fontSize="sm" color={theme.text.onBrandMuted}>
              Font size
            </Text>
            <SegmentedControl
              options={FONT_SIZE_OPTIONS}
              value={captions.fontSize}
              onChange={(v) => onChange({ fontSize: v })}
            />
          </VStack>

          <SettingSlider
            label="Words per group"
            value={captions.wordsPerGroup}
            min={1}
            max={12}
            onChange={(v) => onChange({ wordsPerGroup: clampWordsPerGroup(v) })}
          />

          <SettingRow
            label="Wrap long lines"
            control={<ModernSwitch checked={captions.wrap} onCheckedChange={(v) => onChange({ wrap: v })} />}
          />

          <SettingRow
            label="UPPERCASE"
            control={<ModernSwitch checked={captions.uppercase} onCheckedChange={(v) => onChange({ uppercase: v })} />}
          />

          <VStack align="stretch" gap={2}>
            <Text fontSize="sm" color={theme.text.onBrandMuted}>
              Background
            </Text>
            <SegmentedControl
              options={BOX_STYLE_OPTIONS}
              value={captions.boxStyle}
              onChange={(v) => onChange({ boxStyle: v })}
            />
          </VStack>

          {captions.boxStyle !== "none" && (
            <SettingSlider
              label="Background opacity"
              value={Math.round(captions.boxOpacity * 100)}
              min={0}
              max={100}
              valueLabel={`${Math.round(captions.boxOpacity * 100)}%`}
              onChange={(v) => onChange({ boxOpacity: v / 100 })}
            />
          )}

          <HStack justify="space-between" align="center">
            <Text fontSize="sm" color={theme.text.onBrandMuted}>
              Highlight color
            </Text>
            <Input
              type="color"
              value={captions.highlightColor}
              onChange={(e) => onChange({ highlightColor: e.target.value })}
              w="56px"
              h="32px"
              p={0.5}
              borderRadius="md"
              border="1px solid"
              borderColor={theme.surface.elevated}
              bg="transparent"
            />
          </HStack>

          {enabledFormats.length > 1 && (
            <VStack align="stretch" gap={2}>
              <Text fontSize="sm" color={theme.text.onBrandMuted}>
                Disable captions per format
              </Text>
              <HStack gap={2} flexWrap="wrap">
                {enabledFormats.map((f) => (
                  <SettingRow
                    key={f.id}
                    label={f.label}
                    control={
                      <ModernSwitch
                        checked={!captions.disabledForFormatIds.includes(f.id)}
                        onCheckedChange={() => toggleFormatDisabled(f.id)}
                      />
                    }
                  />
                ))}
              </HStack>
            </VStack>
          )}
        </>
      )}
    </SettingSection>
  );
};
