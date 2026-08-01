import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { useCloudTranscriptionProvider } from "../../hooks/use-cloud-transcription-provider.hook";

interface CloudTranscriptionProviderRowProps {
  provider: CloudTranscriptionProvider;
  name: string;
  description: string;
  keyHint: string;
  selected: boolean;
  onSelect?: () => void;
}

export function CloudTranscriptionProviderRow({
  provider,
  name,
  description,
  keyHint,
  selected,
  onSelect,
}: CloudTranscriptionProviderRowProps) {
  const { theme, mode } = useClipperUi();
  const {
    publicView,
    apiKeyInput,
    setApiKeyInput,
    saving,
    testing,
    error,
    success,
    handleSave,
    handleTest,
    handleClear,
  } = useCloudTranscriptionProvider(provider);

  const borderColor = mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const canActivate = publicView.isKeyConfigured;

  return (
    <Box
      borderWidth="1px"
      borderStyle="solid"
      borderColor={borderColor}
      borderRadius="12px"
      p={{ base: 6, md: 8 }}
      w="full"
    >
      <VStack align="stretch" gap={6}>
        <HStack align="start" justify="space-between" gap={6}>
          <VStack align="start" gap={2} minW={0} flex={1}>
            <Text
              fontSize={{ base: "xl", md: "2xl" }}
              fontWeight="semibold"
              letterSpacing="-0.03em"
              lineHeight="1.15"
              color={theme.text.primary}
            >
              {name}
            </Text>
            <Text fontSize="sm" color={theme.text.muted} lineHeight="1.6" maxW="36em">
              {description}
            </Text>
          </VStack>

          {onSelect && (
            <HStack gap={2} flexShrink={0} pt={1}>
              <OutlinedActionButton
                onClick={onSelect}
                disabled={selected || !canActivate}
                whiteSpace="nowrap"
              >
                {selected ? "Active" : "Use this model"}
              </OutlinedActionButton>
            </HStack>
          )}
        </HStack>

        <VStack align="stretch" gap={3}>
          <Text fontSize="xs" color={theme.text.muted}>
            Status:{" "}
            {publicView.isKeyConfigured
              ? `Key configured (${publicView.keyPreview})`
              : "No API key saved"}
          </Text>
          <Input
            type="password"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder={keyHint}
            autoComplete="off"
            spellCheck={false}
            bg={mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"}
            borderColor={borderColor}
            color={theme.text.primary}
            _placeholder={{ color: theme.text.muted }}
          />
          <HStack gap={2} flexWrap="wrap">
            <OutlinedActionButton
              onClick={() => void handleSave()}
              loading={saving}
              disabled={!apiKeyInput.trim()}
              whiteSpace="nowrap"
            >
              Save key
            </OutlinedActionButton>
            <OutlinedActionButton
              onClick={() => void handleTest()}
              loading={testing}
              whiteSpace="nowrap"
            >
              Test key
            </OutlinedActionButton>
            {publicView.isKeyConfigured && (
              <OutlinedActionButton
                tone="danger"
                onClick={() => void handleClear()}
                whiteSpace="nowrap"
              >
                Remove key
              </OutlinedActionButton>
            )}
          </HStack>
        </VStack>

        {success && (
          <Text fontSize="sm" color={theme.status.success} lineHeight="1.6">
            {success}
          </Text>
        )}
        {error && (
          <Text fontSize="sm" color={theme.status.danger} lineHeight="1.6">
            {error}
          </Text>
        )}
        {!canActivate && selected && (
          <Text fontSize="sm" color={theme.status.danger} lineHeight="1.6">
            Save a valid API key before using this provider.
          </Text>
        )}
      </VStack>
    </Box>
  );
}
