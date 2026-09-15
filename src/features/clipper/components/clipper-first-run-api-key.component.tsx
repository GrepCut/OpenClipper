import { useState } from "react";
import { HStack, Input, Text, VStack } from "@chakra-ui/react";
import type {
  CloudTranscriptionProvider,
  TranscriptionApiKeyPublicView,
} from "../../../services/transcription-api-keys.service";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { openExternalUrl } from "../../../shared/utils/open-external-url.util";
import { useTheme } from "../../../theme";

const KEY_URLS: Record<CloudTranscriptionProvider, string> = {
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/settings/keys",
};

const PROVIDER_LABELS: Record<CloudTranscriptionProvider, string> = {
  groq: "Groq",
  openrouter: "OpenRouter",
};

function ProviderLabel({
  id,
  selected,
  onSelect,
}: {
  id: CloudTranscriptionProvider;
  selected: boolean;
  onSelect: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Text
      asChild
      fontSize="sm"
      fontWeight={selected ? "semibold" : "medium"}
      color={selected ? theme.text.primary : theme.text.muted}
      cursor="pointer"
    >
      <button type="button" onClick={onSelect}>
        {PROVIDER_LABELS[id]}
      </button>
    </Text>
  );
}

function ExternalKeyLink({
  provider,
  children,
}: {
  provider: CloudTranscriptionProvider;
  children: string;
}) {
  const { theme } = useTheme();
  return (
    <Text
      asChild
      fontSize="xs"
      color={theme.text.muted}
      cursor="pointer"
      textDecoration="underline"
      textUnderlineOffset="2px"
    >
      <button type="button" onClick={() => void openExternalUrl(KEY_URLS[provider])}>
        {children}
      </button>
    </Text>
  );
}

interface ClipperFirstRunApiKeyProps {
  groq: TranscriptionApiKeyPublicView;
  openrouter: TranscriptionApiKeyPublicView;
  onSave: (provider: CloudTranscriptionProvider, apiKey: string) => Promise<unknown>;
}

export function ClipperFirstRunApiKey({
  groq,
  openrouter,
  onSave,
}: ClipperFirstRunApiKeyProps) {
  const { theme, mode } = useTheme();
  const [provider, setProvider] = useState<CloudTranscriptionProvider>("groq");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = provider === "groq" ? groq : openrouter;
  const borderColor = mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  const handleSave = async () => {
    if (!apiKeyInput.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(provider, apiKeyInput);
      setApiKeyInput("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save API key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={4}>
        <ProviderLabel
          id="groq"
          selected={provider === "groq"}
          onSelect={() => setProvider("groq")}
        />
        <ProviderLabel
          id="openrouter"
          selected={provider === "openrouter"}
          onSelect={() => setProvider("openrouter")}
        />
      </HStack>
      <HStack gap={3} flexWrap="wrap">
        <ExternalKeyLink provider="groq">Get a Groq key (*free)</ExternalKeyLink>
        <Text fontSize="xs" color={theme.text.muted}>
          ·
        </Text>
        <ExternalKeyLink provider="openrouter">Get an OpenRouter key</ExternalKeyLink>
      </HStack>
      <HStack gap={2} align="stretch">
        <Input
          type="password"
          value={apiKeyInput}
          onChange={(event) => setApiKeyInput(event.target.value)}
          placeholder={`${PROVIDER_LABELS[provider]} API key`}
          autoComplete="off"
          spellCheck={false}
          h="36px"
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSave();
          }}
          bg={mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"}
          borderColor={borderColor}
          color={theme.text.primary}
          _placeholder={{ color: theme.text.muted }}
        />
        <OutlinedActionButton
          onClick={() => void handleSave()}
          loading={saving}
          disabled={!apiKeyInput.trim()}
          whiteSpace="nowrap"
          flexShrink={0}
        >
          Save
        </OutlinedActionButton>
      </HStack>
      <Text fontSize="xs" color={theme.text.muted}>
        {selected.isKeyConfigured
          ? `Key saved (${selected.keyPreview})`
          : "No API key saved"}
      </Text>
      {error && (
        <Text fontSize="sm" color={theme.status.danger}>
          {error}
        </Text>
      )}
    </VStack>
  );
}
