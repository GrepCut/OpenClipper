import { Box, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { formatBytes } from "../../shared/logger.util";
import type { ModelStatusBadge } from "../../hooks/use-parakeet-model-download.hook";

interface TranscriptionModelRowProps {
  name?: string;
  description?: string;
  size?: string;
  selected?: boolean;
  onSelect?: () => void;
  badge: ModelStatusBadge;
  provider: string | null;
  showDownload: boolean;
  showDelete: boolean;
  downloading: boolean;
  downloadProgress: number | null;
  downloadReceived: number | null;
  downloadTotal: number | null;
  error: string | null;
  onDownload: () => void;
  onDeleteOpen: () => void;
}

function statusLabel(badge: ModelStatusBadge): string {
  if (badge === "downloading") return "Downloading";
  if (badge === "installed") return "Installed";
  return "Not installed";
}

function MetaCell({ label, value }: { label: string; value: string }) {
  const { theme } = useClipperUi();
  return (
    <VStack align="start" gap={1} minW={0}>
      <Text
        fontSize="11px"
        letterSpacing="0.06em"
        textTransform="uppercase"
        color={theme.text.muted}
        fontWeight="medium"
      >
        {label}
      </Text>
      <Text
        fontSize="sm"
        color={theme.text.primary}
        fontFamily="mono"
        lineClamp={1}
      >
        {value}
      </Text>
    </VStack>
  );
}

export function TranscriptionModelRow({
  name = "Parakeet",
  description = "Local speech-to-text for clip captions. The model loads only while transcribing, then releases its runtime memory.",
  size = "~671 MB",
  selected = false,
  onSelect,
  badge,
  provider,
  showDownload,
  showDelete,
  downloading,
  downloadProgress,
  downloadReceived,
  downloadTotal,
  error,
  onDownload,
  onDeleteOpen,
}: TranscriptionModelRowProps) {
  const { theme, mode } = useClipperUi();
  const borderColor = mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const trackBg = mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const fillBg = theme.text.primary;
  const percent =
    downloadProgress == null
      ? null
      : Math.round(Math.max(0, Math.min(1, downloadProgress)) * 100);

  const bytesLabel =
    downloadReceived != null && downloadTotal != null && downloadTotal > 0
      ? `${formatBytes(downloadReceived)} / ${formatBytes(downloadTotal)}`
      : downloadReceived != null
        ? formatBytes(downloadReceived)
        : size;

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

          {!downloading && (showDownload || showDelete || onSelect) && (
            <HStack gap={2} flexShrink={0} pt={1}>
              {showDownload && (
                <OutlinedActionButton onClick={onDownload} whiteSpace="nowrap">
                  Download
                </OutlinedActionButton>
              )}
              {showDelete && (
                <OutlinedActionButton tone="danger" onClick={onDeleteOpen} whiteSpace="nowrap">
                  Delete
                </OutlinedActionButton>
              )}
              {onSelect && (
                <OutlinedActionButton onClick={onSelect} disabled={selected} whiteSpace="nowrap">
                  {selected ? "Active" : "Use this model"}
                </OutlinedActionButton>
              )}
            </HStack>
          )}
        </HStack>

        <HStack gap={{ base: 6, md: 10 }} flexWrap="wrap" align="start">
          <MetaCell label="Status" value={statusLabel(badge)} />
          <MetaCell label="Size" value={downloading ? bytesLabel : size} />
          {provider && <MetaCell label="Runtime" value={provider} />}
        </HStack>

        {downloading && (
          <Box w="full">
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" color={theme.text.muted} fontFamily="mono">
                {bytesLabel}
              </Text>
              <Text fontSize="sm" color={theme.text.muted} fontFamily="mono">
                {percent != null ? `${percent}%` : "…"}
              </Text>
            </HStack>
            <Progress.Root value={percent} size="xs">
              <Progress.Track bg={trackBg} borderRadius="2px" h="3px">
                <Progress.Range bg={fillBg} borderRadius="2px" />
              </Progress.Track>
            </Progress.Root>
          </Box>
        )}

        {error && (
          <Text fontSize="sm" color={theme.status.danger} lineHeight="1.6">
            {error}
          </Text>
        )}
      </VStack>
    </Box>
  );
}
