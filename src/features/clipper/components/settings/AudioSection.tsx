import React from "react";
import { Text, VStack } from "@chakra-ui/react";
import { ModernSwitch } from "../../../../shared/components/ui/ModernSwitch";
import { LUFS_PRESETS } from '../../lib/presets/normalize-presets';
import type { ClipperAudioSettings } from "../../settings/settings";
import { clampFadeSeconds, clampPeakCeiling } from "../../settings/settings";
import { useClipperUi } from "../../shared/use-clipper-ui";
import { SegmentedControl, SettingRow, SettingSection, SettingSlider } from "./SettingControls";

interface AudioSectionProps {
  audio: ClipperAudioSettings;
  onChange: (patch: Partial<ClipperAudioSettings>) => void;
}

const NORMALIZE_OPTIONS = LUFS_PRESETS.map((p) => ({ value: p.value, label: p.name }));

export const AudioSection: React.FC<AudioSectionProps> = ({ audio, onChange }) => {
  const { theme } = useClipperUi();

  return (
    <SettingSection title="Audio" description="Mute, fades, and loudness normalization">
      <SettingRow
        label="Mute original audio"
        control={<ModernSwitch checked={audio.mute} onCheckedChange={(v) => onChange({ mute: v })} />}
      />

      {!audio.mute && (
        <>
          <SettingSlider
            label="Fade in"
            value={audio.fadeInSec}
            min={0}
            max={5}
            step={0.5}
            valueLabel={`${audio.fadeInSec}s`}
            onChange={(v) => onChange({ fadeInSec: clampFadeSeconds(v) })}
          />
          <SettingSlider
            label="Fade out"
            value={audio.fadeOutSec}
            min={0}
            max={5}
            step={0.5}
            valueLabel={`${audio.fadeOutSec}s`}
            onChange={(v) => onChange({ fadeOutSec: clampFadeSeconds(v) })}
          />

          <SettingRow
            label="Loudness normalization"
            control={<ModernSwitch checked={audio.normalize} onCheckedChange={(v) => onChange({ normalize: v })} />}
          />

          {audio.normalize && (
            <>
              <VStack align="stretch" gap={2}>
                <Text fontSize="sm" color={theme.text.onBrandMuted}>
                  Target loudness
                </Text>
                <SegmentedControl
                  options={NORMALIZE_OPTIONS}
                  value={audio.normalizePreset}
                  onChange={(v) => onChange({ normalizePreset: v })}
                />
              </VStack>
              <SettingSlider
                label="Peak ceiling"
                value={audio.peakCeiling}
                min={-6}
                max={0}
                step={0.5}
                valueLabel={`${audio.peakCeiling} dB`}
                onChange={(v) => onChange({ peakCeiling: clampPeakCeiling(v) })}
              />
            </>
          )}
        </>
      )}
    </SettingSection>
  );
};
