import React from "react";
import { Text, VStack } from "@chakra-ui/react";
import { ModernSwitch } from "../../../../shared/components/ui/modern-switch.component";
import { LUFS_PRESETS } from '../../lib/presets/normalize-presets.util';
import type { ClipperAudioSettings } from "../../settings/settings.util";
import { clampFadeSeconds, clampPeakCeiling } from "../../settings/settings.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingRow, SettingSection, SettingSlider } from "./setting-controls.component";

interface AudioSectionProps {
  audio: ClipperAudioSettings;
  onChange: (patch: Partial<ClipperAudioSettings>) => void;
  defaultOpen?: boolean;
}

const NORMALIZE_OPTIONS = LUFS_PRESETS.map((p) => ({ value: p.value, label: p.name }));

export const AudioSection: React.FC<AudioSectionProps> = ({ audio, onChange, defaultOpen = false }) => {
  const { theme } = useClipperUi();

  return (
    <SettingSection title="Audio" description="Mute, fades, and loudness normalization" defaultOpen={defaultOpen}>
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
