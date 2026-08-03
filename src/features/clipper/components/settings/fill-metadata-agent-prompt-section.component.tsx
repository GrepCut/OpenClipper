import { useCallback, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Copy, RotateCcw } from "lucide-react";
import { useTheme } from "../../../../theme";
import { SecondaryMainTitle } from "../../../../shared/fonts/secondary-main-title.font";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { ThemedTextarea } from "../../../../shared/components/ui/themed-input.component";
import { appToast } from "../../../../shared/utils/toast.service";
import { loadClipperSettings, saveClipperSettings } from "../../settings/settings-storage.util";
import {
  CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT,
  getFillMetadataAgentPrompt,
  normalizeFillMetadataAgentPromptForStorage,
} from "../../shared/clipper-fill-metadata-agent-prompt.util";

function readStoredPrompt(): string {
  return loadClipperSettings().publish.fillMetadataAgentPrompt;
}

function readSavedEffectivePrompt(storedValue: string): string {
  return getFillMetadataAgentPrompt({
    publish: { fillMetadataAgentPrompt: storedValue },
  });
}

export function FillMetadataAgentPromptSection() {
  const { theme, mode } = useTheme();
  const [storedValue, setStoredValue] = useState(readStoredPrompt);
  const [draft, setDraft] = useState(() => readSavedEffectivePrompt(readStoredPrompt()));

  const savedEffective = useMemo(
    () => readSavedEffectivePrompt(storedValue),
    [storedValue],
  );
  const isDirty = draft.trim() !== savedEffective;
  const canSave = isDirty && draft.trim().length > 0;
  const canReset =
    isDirty || storedValue.trim() !== "" || draft.trim() !== CLIPPER_FILL_METADATA_AGENT_PROMPT_DEFAULT;

  const persistPrompt = useCallback((nextStored: string, successMessage: string) => {
    const settings = loadClipperSettings();
    const next = {
      ...settings,
      publish: { ...settings.publish, fillMetadataAgentPrompt: nextStored },
    };
    saveClipperSettings(next);
    setStoredValue(nextStored);
    const effective = readSavedEffectivePrompt(nextStored);
    setDraft(effective);
    appToast.success(successMessage);
  }, []);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    persistPrompt(
      normalizeFillMetadataAgentPromptForStorage(draft),
      "Agent prompt saved",
    );
  }, [canSave, draft, persistPrompt]);

  const handleReset = useCallback(() => {
    if (!canReset) return;
    persistPrompt("", "Agent prompt reset to default");
  }, [canReset, persistPrompt]);

  const handleCopyPreview = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      appToast.error("Agent prompt is empty");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      appToast.success("Agent prompt copied");
    } catch {
      appToast.error("Clipboard copy failed");
    }
  }, [draft]);

  return (
    <Box
      w="full"
      bg={mode === "dark" ? "whiteAlpha.50" : "white"}
      p={4}
      borderRadius="2xl"
      border="1px solid"
      borderColor={mode === "dark" ? "whiteAlpha.100" : "gray.100"}
      boxShadow={
        mode === "dark"
          ? "0 4px 24px rgba(0,0,0,0.2)"
          : "0 4px 24px rgba(0,0,0,0.04)"
      }
    >
      <VStack align="stretch" gap={4}>
        <VStack align="start" gap={2}>
          <SecondaryMainTitle>Fill metadata agent prompt</SecondaryMainTitle>
          <Text fontSize="sm" color={theme.text.muted} lineHeight="1.6">
            Instructions copied from the Publish map for AI agents that use the Open Clipper
            MCP server to fill missing export titles, descriptions, and hashtags.
          </Text>
        </VStack>

        <HStack justify="flex-end" gap={2} flexWrap="wrap">
          <OutlinedActionButton
              size="sm"
              startIcon={<Copy size={16} />}
              onClick={() => void handleCopyPreview()}
              whiteSpace="nowrap"
            >
              Copy preview
            </OutlinedActionButton>
            <OutlinedActionButton
              size="sm"
              startIcon={<RotateCcw size={16} />}
              onClick={handleReset}
              disabled={!canReset}
              whiteSpace="nowrap"
            >
              Reset to default
            </OutlinedActionButton>
            <OutlinedActionButton
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              whiteSpace="nowrap"
            >
              Save
            </OutlinedActionButton>
        </HStack>

        <ThemedTextarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={7}
          resize="vertical"
          w="full"
          fontFamily="mono"
          fontSize="sm"
          lineHeight="1.6"
        />

      </VStack>
    </Box>
  );
}
