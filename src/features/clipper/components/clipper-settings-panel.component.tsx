import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperSettings } from "../settings/settings.util";
import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperSettingsDrawerPanel } from "./clipper-settings-drawer.types";
import { BrandingSection } from "./settings/branding-section.component";
import { CaptionsSection } from "./settings/captions-section.component";
import { PartsOverlaySection } from "./settings/parts-overlay-section.component";
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
      case "overlays":
        return (
          <VStack align="stretch" gap={6}>
            <BrandingSection
              branding={settings.branding}
              onChange={(patch) =>
                onUpdateSettings((prev) => ({
                  ...prev,
                  branding: { ...prev.branding, ...patch },
                }))
              }
            />
            <PartsOverlaySection
              partsOverlay={settings.partsOverlay}
              onChange={(patch) =>
                onUpdateSettings((prev) => ({
                  ...prev,
                  partsOverlay: { ...prev.partsOverlay, ...patch },
                }))
              }
            />
          </VStack>
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
