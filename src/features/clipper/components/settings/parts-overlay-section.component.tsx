import { Text, VStack } from "@chakra-ui/react";
import { ThemedInput } from "../../../../shared/components/ui/themed-input.component";
import {
  CLIPPER_PARTS_OVERLAY_LABEL_MAX_LENGTH,
  DEFAULT_CLIPPER_PARTS_OVERLAY_SETTINGS,
  type ClipperPartsOverlaySettings,
} from "../../settings/parts-overlay-settings.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingSegmentedControl } from "./setting-controls.component";

const PART_VISIBILITY_OPTIONS = [
  { value: "on", label: "Show parts" },
  { value: "off", label: "Off" },
] as const;

const PART_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
] satisfies { value: ClipperPartsOverlaySettings["size"]; label: string }[];

const PART_PRESET_OPTIONS = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "yellow", label: "Yellow" },
] satisfies { value: ClipperPartsOverlaySettings["preset"]; label: string }[];

interface PartsOverlaySectionProps {
  partsOverlay: ClipperPartsOverlaySettings;
  onChange: (patch: Partial<ClipperPartsOverlaySettings>) => void;
}

export function PartsOverlaySection({ partsOverlay, onChange }: PartsOverlaySectionProps) {
  const { theme } = useClipperUi();

  return (
    <VStack align="stretch" gap={5} pt={6} borderTop="1px solid" borderColor={theme.border.primary}>
      <SettingSegmentedControl
        label="Parts"
        options={PART_VISIBILITY_OPTIONS}
        value={partsOverlay.enabled ? "on" : "off"}
        onChange={(value) => onChange({ enabled: value === "on" })}
      />

      {partsOverlay.enabled && (
        <VStack align="stretch" gap={4}>
          <VStack as="label" align="stretch" gap={1.5}>
            <Text as="span" fontSize="sm" color={theme.text.onBrandMuted}>Part label</Text>
            <ThemedInput
              value={partsOverlay.label}
              placeholder={DEFAULT_CLIPPER_PARTS_OVERLAY_SETTINGS.label}
              maxLength={CLIPPER_PARTS_OVERLAY_LABEL_MAX_LENGTH}
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </VStack>
          <VStack align="stretch" gap={1.5} role="group" aria-label="Font size">
            <Text fontSize="sm" color={theme.text.onBrandMuted}>Font size</Text>
            <SegmentedControl
              options={PART_SIZE_OPTIONS}
              value={partsOverlay.size}
              onChange={(size) => onChange({ size })}
            />
          </VStack>
          <VStack align="stretch" gap={1.5} role="group" aria-label="Style">
            <Text fontSize="sm" color={theme.text.onBrandMuted}>Style</Text>
            <SegmentedControl
              options={PART_PRESET_OPTIONS}
              value={partsOverlay.preset}
              onChange={(preset) => onChange({ preset })}
            />
          </VStack>
        </VStack>
      )}
    </VStack>
  );
}
