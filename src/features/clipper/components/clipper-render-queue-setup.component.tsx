import React, { useMemo } from "react";
import { Box, Button, Checkbox, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { Clapperboard, Minus } from "lucide-react";
import { MainButton } from "../../../shared/components/buttons/main-button.component";
import { CLIPPER_FORMAT_DEFS } from "../shared/formats.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ExistingExportsByClip } from "../shared/existing-exports.util";
import type { ClipperClipPreview } from "../shared/state.util";
import type { ClipperFormatSettings } from "../settings/settings.util";
import { ExportFormatControls } from "./settings/platforms-section.component";
import { ClipperRenderQueueSetupRow } from "./clipper-render-queue-setup-row.component";
import { useClipThumbnails } from "../hooks/use-clip-thumbnails.hook";
import {
  clipTranscriptsByIndex,
  computeRenderQueueSelectionStats,
  type ClipThumbSpec,
} from "./clipper-render-queue-setup.util";

interface ClipperRenderQueueSetupProps {
  clipPreviews: ClipperClipPreview[];
  rangeTrimmedVideoUrl: string;
  formats: ClipperFormatSettings;
  onChangeFormats: (patch: Partial<ClipperFormatSettings>) => void;
  getClipFormatIds: (clipIndex: number) => string[];
  onToggleClipFormat: (clipIndex: number, formatId: string) => void;
  onSetFormatForAll: (formatId: string, enabled: boolean) => void;
  onSetAllFormatsForClip: (clipIndex: number, enabled: boolean) => void;
  isRendering: boolean;
  existingExports: ExistingExportsByClip;
  onRender: () => void;
  exportCount?: number;
  onViewExports?: () => void;
}

export const ClipperRenderQueueSetup: React.FC<ClipperRenderQueueSetupProps> = ({
  clipPreviews,
  rangeTrimmedVideoUrl,
  formats,
  onChangeFormats,
  getClipFormatIds,
  onToggleClipFormat,
  onSetFormatForAll,
  onSetAllFormatsForClip,
  isRendering,
  existingExports,
  onRender,
  exportCount = 0,
  onViewExports,
}) => {
  const { theme, outlineButton } = useClipperUi();

  const thumbSpecsKey = clipPreviews
    .map((p) => `${p.clip.index}:${p.clip.startSec}:${p.clip.durationSec}`)
    .join("|");
  const thumbSpecs = useMemo<ClipThumbSpec[]>(
    () =>
      clipPreviews.map((p) => ({
        index: p.clip.index,
        startSec: p.clip.startSec,
        durationSec: p.clip.durationSec,
      })),
    [thumbSpecsKey],
  );
  const { registerRow, setCanvasRef } = useClipThumbnails(rangeTrimmedVideoUrl, thumbSpecs);

  const transcripts = useMemo(() => clipTranscriptsByIndex(clipPreviews), [clipPreviews]);
  const skipExisting = formats.skipExisting;
  const { globalState, globalExported, clipsWithFormats, totalOutputs, exportedOutputs } = useMemo(
    () =>
      computeRenderQueueSelectionStats(clipPreviews, getClipFormatIds, existingExports, skipExisting),
    [clipPreviews, existingExports, getClipFormatIds, skipExisting],
  );

  const skippedLabel = skipExisting && exportedOutputs > 0 ? ` (${exportedOutputs} skipped)` : "";
  const renderLabel =
    totalOutputs === 0
      ? exportedOutputs > 0 && skipExisting
        ? "All selected outputs already exported"
        : "Render"
      : `Render ${clipsWithFormats} clip${clipsWithFormats > 1 ? "s" : ""} • ${totalOutputs} output${totalOutputs > 1 ? "s" : ""}${skippedLabel}`;

  return (
    <VStack align="stretch" gap={6}>
      <HStack justify="space-between" flexWrap="wrap" gap={3}>
        <Box>
          <Text fontSize="2xl" fontWeight="bold" color={theme.text.primary} mb={1}>
            Render queue
          </Text>
          <Text fontSize="sm" color={theme.text.muted}>
            Choose which formats to render for each clip.
          </Text>
        </Box>
        <HStack gap={3} flexWrap="wrap">
          {(exportCount > 0 || isRendering) && onViewExports ? (
            <Button
              size="lg"
              variant="outline"
              borderRadius="2xl"
              h="44px"
              onClick={onViewExports}
              {...outlineButton}
            >
              Your exports{exportCount > 0 ? ` (${exportCount})` : ""}
            </Button>
          ) : null}
          <MainButton
            h="44px"
            px={6}
            fontSize="sm"
            fontWeight="semibold"
            borderRadius="full"
            display="inline-flex"
            alignItems="center"
            gap={2}
            bg={`linear-gradient(to right, ${clipperTheme.gradientFrom}, ${clipperTheme.gradientTo})`}
            color={theme.text.onBrand}
            boxShadow={`0 0 16px rgba(${clipperTheme.ctaTintRgb}, 0.28)`}
            _hover={{
              filter: "brightness(1.08)",
              transform: "translateY(-1px)",
              boxShadow: `0 4px 20px rgba(${clipperTheme.ctaTintRgb}, 0.4)`,
              _disabled: { transform: "none", filter: "none", boxShadow: "none" },
            }}
            _disabled={{ opacity: 0.45, cursor: "not-allowed", boxShadow: "none" }}
            onClick={onRender}
            loading={isRendering}
            disabled={totalOutputs === 0}
          >
            {!isRendering ? <Clapperboard size={18} strokeWidth={2} /> : null}
            {isRendering ? "Rendering…" : renderLabel}
          </MainButton>
        </HStack>
      </HStack>

      <VStack
        align="stretch"
        gap={4}
        p={{ base: 4, md: 5 }}
        borderRadius="xl"
        border="1px solid"
        borderColor={theme.border.primary}
        bg={theme.surface.inset}
      >
        <HStack gap={6} flexWrap="wrap" align="flex-start" w="full">
          <VStack align="stretch" gap={1.5} flex="1" minW={{ base: "full", lg: "280px" }}>
            <Text fontSize="xs" color={theme.text.onBrandMuted} lineHeight="1">
              All clips
            </Text>
            <Flex minH="32px" align="center" flexWrap="wrap" gap={3}>
              {CLIPPER_FORMAT_DEFS.map((def) => {
                const checked = globalState[def.id] ?? false;
                return (
                  <Checkbox.Root
                    key={def.id}
                    size="sm"
                    colorPalette="blue"
                    checked={checked}
                    onCheckedChange={() => onSetFormatForAll(def.id, checked !== true)}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control>
                      <Checkbox.Indicator indeterminate={<Minus size={12} />} />
                    </Checkbox.Control>
                    <Checkbox.Label>
                      <Text
                        fontSize="sm"
                        color={globalExported[def.id] ? theme.status.danger : theme.text.onBrandMuted}
                        title={globalExported[def.id] ? "Already exported for every selected clip" : undefined}
                      >
                        {def.label}
                      </Text>
                    </Checkbox.Label>
                  </Checkbox.Root>
                );
              })}
            </Flex>
          </VStack>

          <VStack align="stretch" gap={1.5} flexShrink={0}>
            <Text fontSize="xs" color={theme.text.onBrandMuted} lineHeight="1">
              Duplicates
            </Text>
            <Flex minH="32px" align="center">
              <Checkbox.Root
                size="sm"
                colorPalette="blue"
                checked={skipExisting}
                onCheckedChange={() => onChangeFormats({ skipExisting: !skipExisting })}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>
                  <Text fontSize="sm" color={theme.text.onBrandMuted}>
                    Skip already exported
                  </Text>
                </Checkbox.Label>
              </Checkbox.Root>
            </Flex>
          </VStack>

          <ExportFormatControls formats={formats} onChange={onChangeFormats} layout="bar" />
        </HStack>
      </VStack>

      <VStack align="stretch" gap={2}>
        {clipPreviews.map((preview) => (
          <ClipperRenderQueueSetupRow
            key={preview.clip.index}
            preview={preview}
            selectedIds={getClipFormatIds(preview.clip.index)}
            exported={existingExports[preview.clip.index]}
            skipExisting={skipExisting}
            transcript={transcripts.get(preview.clip.index) ?? ""}
            registerThumbRow={registerRow}
            setCanvasRef={setCanvasRef}
            onToggleClipFormat={onToggleClipFormat}
            onSetAllFormatsForClip={onSetAllFormatsForClip}
          />
        ))}
      </VStack>
    </VStack>
  );
};
