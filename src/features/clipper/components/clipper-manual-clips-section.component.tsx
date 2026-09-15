import React, { useMemo, useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { Plus, Scissors } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { wordSpanForClip } from "../engine/transcript";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperClipSelector } from "./clipper-clip-selector.component";
import { ClipperManualClipModal } from "./clipper-manual-clip-modal.component";
import {
  clipSelectorTranscriptProps,
  type ClipperManualClipsSectionProps,
} from "./clipper-clips-section.types";

type ManualEditor =
  | { mode: "create" }
  | { mode: "edit"; clipIndex: number };

export function ClipperManualClipsSection({
  clipPreviews,
  activeClipIndex,
  onSelectClip,
  onDeleteManualClip,
  onUpsertManualClip,
  onOpenInStudio,
  openingInStudio = false,
  rangeWords,
  collageRegions,
  disabledCollageRegionIds,
  onToggleCollageRegion,
  onSeekToTranscriptTime,
  rangeTrimmedVideoUrl,
  rangeDurationSec,
  getRangeFrameContext,
  onManualEditorOpen,
}: ClipperManualClipsSectionProps) {
  const { theme } = useClipperUi();
  const [editor, setEditor] = useState<ManualEditor | null>(null);
  const transcriptProps = clipSelectorTranscriptProps(
    rangeWords,
    collageRegions,
    disabledCollageRegionIds,
    onToggleCollageRegion,
    onSeekToTranscriptTime,
  );

  const initialRange = useMemo(() => {
    if (editor?.mode !== "edit") return null;
    const preview = clipPreviews.find((item) => item.clip.index === editor.clipIndex);
    return preview ? wordSpanForClip(preview.clip, rangeWords) : null;
  }, [clipPreviews, editor, rangeWords]);

  const canAuthor = rangeWords.length > 0 && Boolean(onUpsertManualClip);

  const openEditor = (next: ManualEditor) => {
    onManualEditorOpen?.();
    setEditor(next);
  };

  return (
    <Box flex="1" minH={0} display="flex" flexDirection="column">
      {clipPreviews.length > 0 ? (
        <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
          <ClipperClipSelector
            clipPreviews={clipPreviews}
            activeClipIndex={activeClipIndex}
            onSelectClip={onSelectClip}
            onDeleteClip={onDeleteManualClip}
            onEditClip={canAuthor ? (index) => openEditor({ mode: "edit", clipIndex: index }) : undefined}
            onOpenInStudio={onOpenInStudio}
            openingInStudio={openingInStudio}
            hideTitle
            {...transcriptProps}
          />
        </Box>
      ) : (
        <Box
          flex="1"
          minH={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          px={6}
        >
          <VStack gap={4} textAlign="center" maxW="360px">
            <Box color={clipperTheme.accentLight} opacity={0.9}>
              <Scissors size={52} />
            </Box>
            <VStack gap={1.5}>
              <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                No manual clips yet
              </Text>
              <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
                Pick a start word and an end word to add a clip from the transcript.
              </Text>
            </VStack>
            <OutlinedActionButton
              startIcon={<Plus size={16} />}
              onClick={() => openEditor({ mode: "create" })}
              disabled={!canAuthor}
            >
              Add clip
            </OutlinedActionButton>
          </VStack>
        </Box>
      )}

      {clipPreviews.length > 0 ? (
        <Box flexShrink={0} px={4} py={3} borderTop="1px solid" borderColor={theme.border.primary}>
          <OutlinedActionButton
            startIcon={<Plus size={16} />}
            onClick={() => openEditor({ mode: "create" })}
            disabled={!canAuthor}
            width="100%"
            justifyContent="flex-start"
          >
            Add clip
          </OutlinedActionButton>
        </Box>
      ) : null}

      <ClipperManualClipModal
        isOpen={editor != null}
        onClose={() => setEditor(null)}
        onSave={(range) => {
          if (!onUpsertManualClip) return;
          onUpsertManualClip(range, editor?.mode === "edit" ? editor.clipIndex : undefined);
        }}
        words={rangeWords}
        durationSec={Math.max(rangeDurationSec, rangeWords.at(-1)?.end ?? 0)}
        videoUrl={rangeTrimmedVideoUrl}
        initialRange={initialRange}
        getRangeFrameContext={getRangeFrameContext}
        mode={editor?.mode === "edit" ? "edit" : "create"}
      />
    </Box>
  );
}
