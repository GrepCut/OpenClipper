import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperSettings } from "../settings/settings.util";
import type { WordCue } from "../lib/media/transcription-export.util";
import { CaptionsSection } from "./settings/captions-section.component";
import { TranscriptSection } from "./settings/transcript-section.component";

interface ClipperSettingsPanelProps {
  settings: ClipperSettings;
  words: WordCue[];
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  /** Hide transcript preview (e.g. global defaults on the projects home screen). */
  hideTranscript?: boolean;
}

export const ClipperSettingsPanel: React.FC<ClipperSettingsPanelProps> = ({
  settings,
  words,
  onUpdateSettings,
  hideTranscript = false,
}) => {
  return (
    <VStack align="stretch" gap={0}>
      {!hideTranscript && <TranscriptSection words={words} />}
      <CaptionsSection
        captions={settings.captions}
        onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, captions: { ...prev.captions, ...patch } }))}
      />
    </VStack>
  );
};
