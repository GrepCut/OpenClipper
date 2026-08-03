import React, { useEffect, useMemo, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { ThemedSelect } from "../../../shared/components/ui/themed-select.component";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { fetchClipperRangeWords } from "../persistence/clipper-range-words-api.util";
import { useClipperOwners } from "../hooks/use-clipper-owners.hook";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";
import { getClipperFormatDef } from "../shared/formats.util";

interface SelectedPublishProject {
  projectId: string;
  projectName: string;
  clipperOwnerId: string | null;
  clipperOwnerName: string | null;
  exports: ClipperExportMapItem[];
}

interface ClipperPublishProjectPanelProps {
  project: SelectedPublishProject | null;
  canPublish: boolean;
  publishLoadingExportId: string | null;
  onPublishExport: (item: ClipperExportMapItem) => void;
  connectedSplit?: boolean;
}

function wordsToPlainTranscript(words: Array<{ text: string }>): string {
  return words.map((word) => word.text).join(" ").trim();
}

export function ClipperPublishProjectPanel({
  project,
  canPublish,
  publishLoadingExportId,
  onPublishExport,
  connectedSplit = false,
}: ClipperPublishProjectPanelProps) {
  const { theme } = useClipperUi();
  const { owners, assignProjectOwner } = useClipperOwners();
  const [transcript, setTranscript] = useState("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  useEffect(() => {
    if (!project) {
      setTranscript("");
      return;
    }

    let cancelled = false;
    setTranscriptLoading(true);
    void fetchClipperRangeWords(project.projectId)
      .then((words) => {
        if (cancelled) return;
        const plain = wordsToPlainTranscript(words);
        if (plain) {
          setTranscript(plain);
          return;
        }
        const fallback = project.exports.find((item) => item.transcriptPlain.trim())?.transcriptPlain ?? "";
        setTranscript(fallback);
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = project.exports.find((item) => item.transcriptPlain.trim())?.transcriptPlain ?? "";
          setTranscript(fallback);
        }
      })
      .finally(() => {
        if (!cancelled) setTranscriptLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project]);

  const ownerSelectOptions = useMemo(
    () => [
      { value: "", label: "Unassigned" },
      ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
    ],
    [owners],
  );

  const hasOwner = Boolean(project?.clipperOwnerId);
  const sortedExports = useMemo(() => {
    if (!project) return [];
    return [...project.exports].sort(
      (a, b) => a.clipIndex - b.clipIndex || a.formatLabel.localeCompare(b.formatLabel),
    );
  }, [project]);

  if (!project) {
    return (
      <Box
        h="full"
        borderRadius={connectedSplit ? 0 : "2xl"}
        border={connectedSplit ? "none" : "1px dashed"}
        borderColor={theme.dashboard.border}
        bg={connectedSplit ? "transparent" : theme.background.card}
        p={8}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text color={theme.text.muted} textAlign="center">
          Select the project hub on the map to assign an owner and publish exports.
        </Text>
      </Box>
    );
  }

  return (
    <VStack
      align="stretch"
      h="full"
      gap={4}
      borderRadius={connectedSplit ? 0 : "2xl"}
      border={connectedSplit ? "none" : "1px solid"}
      borderColor={theme.border.primary}
      bg={connectedSplit ? "transparent" : theme.background.card}
      p={4}
      overflow="auto"
    >
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          {project.projectName}
        </Text>
        <Text fontSize="xs" color={theme.text.muted}>
          {project.exports.length} exports
        </Text>
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Owner
        </Text>
        <ThemedSelect
          value={project.clipperOwnerId ?? ""}
          onChange={(value) => void assignProjectOwner(project.projectId, value || null)}
          options={ownerSelectOptions}
        />
        {!hasOwner ? (
          <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5">
            Assign an owner before publishing. Owner channels are configured in the Owners tab.
          </Text>
        ) : null}
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Publish
        </Text>
        {sortedExports.map((item) => {
          const formatDef = getClipperFormatDef(item.formatId);
          const watchUrl = item.publishStatus?.watchUrl;

          return (
            <HStack
              key={item.id}
              align="center"
              gap={3}
              borderRadius="xl"
              border="1px solid"
              borderColor={theme.surface.hover}
              bg={theme.surface.faint}
              px={3}
              py={2.5}
            >
              {formatDef ? <ClipperPlatformIcon platform={formatDef.platform} size={24} /> : null}
              <VStack align="start" gap={0} flex={1} minW={0}>
                <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} lineClamp={1}>
                  {item.formatLabel}
                </Text>
                <Text fontSize="xs" color={theme.text.muted}>
                  Clip {item.clipIndex + 1}
                </Text>
              </VStack>
              {item.isPublished ? (
                <HStack gap={2} flexShrink={0}>
                  <CheckCircle2 size={16} color="#22c55e" />
                  {watchUrl ? (
                    <Box asChild>
                      <a href={watchUrl} target="_blank" rel="noopener noreferrer">
                        <OutlinedActionButton size="sm" startIcon={<ExternalLink size={14} />}>
                          Open
                        </OutlinedActionButton>
                      </a>
                    </Box>
                  ) : (
                    <Text fontSize="xs" color={theme.text.muted}>
                      Published
                    </Text>
                  )}
                </HStack>
              ) : (
                <OutlinedActionButton
                  flexShrink={0}
                  loading={publishLoadingExportId === item.id}
                  onClick={() => onPublishExport(item)}
                  disabled={!hasOwner || !canPublish}
                >
                  Publish
                </OutlinedActionButton>
              )}
            </HStack>
          );
        })}
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
          Transcript
        </Text>
        {transcriptLoading ? (
          <AppLoader />
        ) : (
          <Box
            borderRadius="lg"
            border="1px solid"
            borderColor={theme.surface.hover}
            bg={theme.surface.faint}
            p={3}
            maxH="240px"
            overflow="auto"
          >
            <Text fontSize="sm" color={theme.text.primary} whiteSpace="pre-wrap">
              {transcript || "No transcript saved for this project yet."}
            </Text>
          </Box>
        )}
      </VStack>
    </VStack>
  );
}
