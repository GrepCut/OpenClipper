import React, { useMemo } from "react";
import { Text } from "@chakra-ui/react";
import type { WordCue } from "../../lib/media/transcription-export.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SettingSection } from "./setting-controls.component";

interface TranscriptSectionProps {
  words: WordCue[];
}

/** Read-only transcript text — lets you check what was actually transcribed before adjusting caption styling or rendering. */
export const TranscriptSection: React.FC<TranscriptSectionProps> = ({ words }) => {
  const { theme } = useClipperUi();
  const text = useMemo(() => words.map((w) => w.text).join(" "), [words]);

  return (
    <SettingSection title="Transcript" description="What was transcribed for this clip" defaultOpen>
      {text ? (
        <Text fontSize="sm" color={theme.text.onBrandMuted} lineHeight="1.6">
          {text}
        </Text>
      ) : (
        <Text fontSize="sm" color={theme.text.muted}>
          No speech detected in this clip.
        </Text>
      )}
    </SettingSection>
  );
};
