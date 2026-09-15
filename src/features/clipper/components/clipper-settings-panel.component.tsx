import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperSettings } from "../settings/settings.util";
import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperSettingsDrawerPanel } from "./clipper-settings-drawer.types";
import { BrandingSection } from "./settings/branding-section.component";
import { CaptionsSection } from "./settings/captions-section.component";
import { TranscriptSection } from "./settings/transcript-section.component";

interface ClipperSettingsPanelProps {
  settings: ClipperSettings;
  words: WordCue[];
  onUpdateSettings: (
    updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings),
  ) => void;
  /** Hide transcript preview (e.g. global defaults on the projects home screen). */
  hideTranscript?: boolean;
  activePanel?: ClipperSettingsDrawerPanel;
}

export const ClipperSettingsPanel: React.FC<ClipperSettingsPanelProps> = ({
  settings,
  words,
  onUpdateSettings,
  hideTranscript = false,
  activePanel = "captions",
}) => {
  const renderPanel = () => {
    switch (activePanel) {
      case "captions":
        return (
          <CaptionsSection
            captions={settings.captions}
            onChange={(patch) =>
              onUpdateSettings((prev) => ({
                ...prev,
                captions: { ...prev.captions, ...patch },
              }))
            }
          />
        );
      case "branding":
        return (
          <BrandingSection
            branding={settings.branding}
            onChange={(patch) =>
              onUpdateSettings((prev) => ({
                ...prev,
                branding: { ...prev.branding, ...patch },
              }))
            }
          />
        );
    }
  };

  return (
    <VStack align="stretch" gap={0}>
      {!hideTranscript && <TranscriptSection words={words} />}
      {renderPanel()}
    </VStack>
  );
};
