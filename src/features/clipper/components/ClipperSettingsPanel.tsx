import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperSettings } from "../settings/settings";
import type { WordCue } from "../lib/media/transcription-export";
import { CLIPPER_FORMAT_DEFS } from "../shared/formats";
import { AudioSection } from "./settings/AudioSection";
import { BrandingSection } from "./settings/BrandingSection";
import { CaptionsSection } from "./settings/CaptionsSection";
import { PlatformsSection } from "./settings/PlatformsSection";
import { ReframeSection } from "./settings/ReframeSection";
import { TranscriptionSection } from "./settings/TranscriptionSection";
import { TranscriptSection } from "./settings/TranscriptSection";

interface ClipperSettingsPanelProps {
  settings: ClipperSettings;
  words: WordCue[];
  hasDetectedFaces: boolean | null;
  hasTwoSpeakers: boolean | null;
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  /** Hide transcript preview (e.g. global defaults on the projects home screen). */
  hideTranscript?: boolean;
}

export const ClipperSettingsPanel: React.FC<ClipperSettingsPanelProps> = ({
  settings,
  words,
  hasDetectedFaces,
  hasTwoSpeakers,
  onUpdateSettings,
  hideTranscript = false,
}) => {
  return (
    <VStack align="stretch" gap={0}>
      {!hideTranscript && <TranscriptSection words={words} />}
      <TranscriptionSection
        transcription={settings.transcription}
        onChange={(patch) =>
          onUpdateSettings((prev) => ({
            ...prev,
            transcription: { ...prev.transcription, ...patch },
          }))
        }
      />
      <ReframeSection
        reframe={settings.reframe}
        hasDetectedFaces={hasDetectedFaces}
        hasTwoSpeakers={hasTwoSpeakers}
        onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, reframe: { ...prev.reframe, ...patch } }))}
      />
      <CaptionsSection
        captions={settings.captions}
        enabledFormats={CLIPPER_FORMAT_DEFS}
        onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, captions: { ...prev.captions, ...patch } }))}
      />
      <PlatformsSection
        formats={settings.formats}
        onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, formats: { ...prev.formats, ...patch } }))}
      />
      <AudioSection
        audio={settings.audio}
        onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, audio: { ...prev.audio, ...patch } }))}
      />
      <BrandingSection
        branding={settings.branding}
        onChange={(patch) => onUpdateSettings((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }))}
      />
    </VStack>
  );
};
