import React from "react";
import { Text, VStack } from "@chakra-ui/react";
import type {
  ClipperHeadroom,
  ClipperReframeSettings,
} from "../../settings/settings.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingRow, SettingSection } from "./setting-controls.component";

interface ReframeSectionProps {
  reframe: ClipperReframeSettings;
  hasDetectedFaces: boolean | null;
  hasTwoSpeakers: boolean | null;
  onChange: (patch: Partial<ClipperReframeSettings>) => void;
}

const HEADROOM_OPTIONS: { value: ClipperHeadroom; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
];

export const ReframeSection: React.FC<ReframeSectionProps> = ({
  reframe,
  hasDetectedFaces,
  hasTwoSpeakers,
  onChange,
}) => {
  const { theme } = useClipperUi();
  return (
    <SettingSection title="Reframe & crop" description="Smart Follow automatically frames cover-crop formats (Instagram, TikTok…)">
      {hasDetectedFaces === false && (
        <Text fontSize="xs" color={theme.text.muted}>
          No faces detected in this clip — falling back to a center crop.
        </Text>
      )}

      {hasTwoSpeakers === true && (
        <Text fontSize="xs" color={theme.text.muted}>
          Two speakers detected — split-screen applies automatically in formats where they do not fit together.
          Toggle it per clip from the transcript icons on each clip card.
        </Text>
      )}

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Headroom / zoom
        </Text>
        <SegmentedControl
          options={HEADROOM_OPTIONS}
          value={reframe.headroom}
          onChange={(v) => onChange({ headroom: v })}
        />
      </VStack>

      <SettingRow
        label="Show detected face boxes"
        hint="Debug overlay on the scrub preview"
        control={
          <SegmentedControl
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
            ]}
            value={reframe.showDebugFaceBoxes ? "on" : "off"}
            onChange={(v) => onChange({ showDebugFaceBoxes: v === "on" })}
          />
        }
      />
    </SettingSection>
  );
};
