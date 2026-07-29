import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperSettings } from "../settings/settings.util";
import type { WordCue } from "../lib/media/transcription-export.util";
import { AudioSection } from "./settings/audio-section.component";
import { CaptionsSection } from "./settings/captions-section.component";
import { TranscriptSection } from "./settings/transcript-section.component";

interface ClipperSettingsPanelProps {
  settings: ClipperSettings;
  words: WordCue[];
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  /** Hide transcript preview (e.g. global defaults on the projects home screen). */
  hideTranscript?: boolean;
  /** Restrict the panel to one settings category when used from a dedicated drawer. */
  section?: "captions" | "audio";
}

export const ClipperSettingsPanel: React.FC<ClipperSettingsPanelProps> = ({
  settings,
  words,
  onUpdateSettings,
  hideTranscript = false,
  section,
}) => {
  return (
    <VStack align="stretch" gap={0}>
      {!hideTranscript && <TranscriptSection words={words} />}
      {section !== "audio" ? (
        <CaptionsSection
          captions={settings.captions}
          onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, captions: { ...prev.captions, ...patch } }))}
        />
      ) : null}
      {section !== "captions" ? (
        <AudioSection
          audio={settings.audio}
          onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, audio: { ...prev.audio, ...patch } }))}
        />
      ) : null}
    </VStack>
  );
};
