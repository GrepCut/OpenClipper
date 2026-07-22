import React from "react";
import { Text, VStack } from "@chakra-ui/react";
import type {
  ClipperCropMode,
  ClipperFacePickStrategy,
  ClipperHeadroom,
  ClipperReframeSettings,
  ClipperSmoothingStrength,
} from "../../settings/settings.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingRow, SettingSection, SettingSlider } from "./setting-controls.component";

interface ReframeSectionProps {
  reframe: ClipperReframeSettings;
  hasDetectedFaces: boolean | null;
  hasTwoSpeakers: boolean | null;
  onChange: (patch: Partial<ClipperReframeSettings>) => void;
}

const CROP_MODE_OPTIONS: { value: ClipperCropMode; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "smart-follow", label: "Smart Follow" },
  { value: "face-follow", label: "Face Follow" },
  { value: "manual", label: "Manual" },
];

const FACE_PICK_OPTIONS: { value: ClipperFacePickStrategy; label: string }[] = [
  { value: "largest", label: "Largest face" },
  { value: "centered", label: "Most centered" },
];

const SMOOTHING_OPTIONS: { value: ClipperSmoothingStrength; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "balanced", label: "Balanced" },
  { value: "snappy", label: "Snappy" },
];

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
  const needsFaceTrack = reframe.cropMode === "smart-follow" || reframe.cropMode === "face-follow" || reframe.cropMode === "podcast-collage";
  // "Center" also auto-follows the detected speaker (see resolveCropRect in
  // clipper-render.ts) — surface the same hints there, just without the Face
  // Follow/Collage-only fine-tune controls.
  const usesFaceTracking = needsFaceTrack || reframe.cropMode === "center";

  const handleCropMode = (mode: ClipperCropMode) => {
    onChange({ cropMode: mode });
  };

  return (
    <SettingSection title="Reframe & crop" description="How cover-crop formats (Instagram, TikTok…) are framed">
      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Crop mode
        </Text>
        <SegmentedControl options={CROP_MODE_OPTIONS} value={reframe.cropMode} onChange={handleCropMode} />
      </VStack>

      {usesFaceTracking && hasDetectedFaces === false && (
        <Text fontSize="xs" color={theme.text.muted}>
          No faces detected in this clip — falling back to a center crop.
        </Text>
      )}

      {reframe.cropMode !== "manual" && hasTwoSpeakers === true && (
        <Text fontSize="xs" color={theme.text.muted}>
          Two speakers detected — split-screen applies automatically in formats where they do not fit together.
          Toggle it per clip from the transcript icons on each clip card.
        </Text>
      )}

      {reframe.cropMode === "face-follow" && (
        <VStack align="stretch" gap={2}>
          <Text fontSize="sm" color={theme.text.onBrandMuted}>
            Which face to follow
          </Text>
          <SegmentedControl
            options={FACE_PICK_OPTIONS}
            value={reframe.facePickStrategy}
            onChange={(v) => onChange({ facePickStrategy: v })}
          />
        </VStack>
      )}

      {needsFaceTrack && (
        <VStack align="stretch" gap={2}>
          <Text fontSize="sm" color={theme.text.onBrandMuted}>
            Smoothing
          </Text>
          <SegmentedControl
            options={SMOOTHING_OPTIONS}
            value={reframe.smoothing}
            onChange={(v) => onChange({ smoothing: v })}
          />
        </VStack>
      )}

      {needsFaceTrack && (
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
      )}

      {reframe.cropMode === "manual" && (
        <VStack align="stretch" gap={3}>
          <SettingSlider
            label="Focal point — horizontal"
            value={Math.round(reframe.manualFocalPoint.x * 100)}
            min={0}
            max={100}
            valueLabel={`${Math.round(reframe.manualFocalPoint.x * 100)}%`}
            onChange={(v) => onChange({ manualFocalPoint: { ...reframe.manualFocalPoint, x: v / 100 } })}
          />
          <SettingSlider
            label="Focal point — vertical"
            value={Math.round(reframe.manualFocalPoint.y * 100)}
            min={0}
            max={100}
            valueLabel={`${Math.round(reframe.manualFocalPoint.y * 100)}%`}
            onChange={(v) => onChange({ manualFocalPoint: { ...reframe.manualFocalPoint, y: v / 100 } })}
          />
        </VStack>
      )}

      {needsFaceTrack && (
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
      )}
    </SettingSection>
  );
};
