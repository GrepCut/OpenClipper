import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "@chakra-ui/react";
import type { WordCue } from "../lib/media/transcription-export";
import type { ClipTranscriptEditOp, WordSelection } from "../engine/clip-transcript-edit";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import { ClipperTranscriptEmpty } from "./ClipperTranscriptEmpty";

export interface ClipperEditableWordEntry {
  globalIdx: number;
  word: WordCue;
}

export interface ClipperEditableTranscriptProps {
  wordEntries: ClipperEditableWordEntry[];
  lastEditedRange?: { startIdx: number; endIdx: number } | null;
  onEdit: (op: ClipTranscriptEditOp) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  emptyMessage?: string;
}

function normalizeSelection(anchor: number | null, focus: number | null): WordSelection | null {
  if (anchor == null || focus == null) return null;
  return {
    startIdx: Math.min(anchor, focus),
    endIdx: Math.max(anchor, focus),
  };
}

function isWordInRange(globalIdx: number, range: { startIdx: number; endIdx: number } | null | undefined): boolean {
  if (!range) return false;
  return globalIdx >= range.startIdx && globalIdx <= range.endIdx;
}

export const ClipperEditableTranscript: React.FC<ClipperEditableTranscriptProps> = ({
  wordEntries,
  lastEditedRange,
  onEdit,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  emptyMessage = "No speech detected in this range.",
}) => {
  const { theme } = useClipperUi();
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  const selection = useMemo(
    () => normalizeSelection(anchorIdx, focusIdx),
    [anchorIdx, focusIdx],
  );

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const effectiveSelection = useMemo((): WordSelection => {
    if (selection) return selection;
    if (focusIdx != null) return { startIdx: focusIdx, endIdx: focusIdx };
    if (wordEntries.length > 0) {
      const idx = wordEntries[wordEntries.length - 1].globalIdx;
      return { startIdx: idx, endIdx: idx };
    }
    return { startIdx: 0, endIdx: -1 };
  }, [focusIdx, selection, wordEntries]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) onUndo?.();
        return;
      }
      if ((mod && e.key === "z" && e.shiftKey) || (mod && e.key === "y")) {
        e.preventDefault();
        if (canRedo) onRedo?.();
        return;
      }
      if (mod && e.key === "c") {
        e.preventDefault();
        if (selection) onEdit({ type: "copy", selection });
        return;
      }
      if (mod && e.key === "x") {
        e.preventDefault();
        if (selection) {
          onEdit({ type: "cut", selection });
          setAnchorIdx(null);
          setFocusIdx(null);
        }
        return;
      }
      if (mod && e.key === "v") {
        e.preventDefault();
        onEdit({ type: "paste", selection: effectiveSelection });
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (selection) {
          onEdit({ type: "delete", selection });
          setAnchorIdx(null);
          setFocusIdx(null);
        }
        return;
      }
    },
    [canRedo, canUndo, effectiveSelection, onEdit, onRedo, onUndo, selection],
  );

  if (wordEntries.length === 0) {
    return <ClipperTranscriptEmpty message={emptyMessage} />;
  }

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      outline="none"
      fontSize="sm"
      color={theme.text.onBrandMuted}
      lineHeight="1.8"
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      _focusVisible={{
        boxShadow: `0 0 0 2px rgba(${clipperTheme.accentTintRgb},0.35)`,
        borderRadius: "md",
      }}
    >
      {wordEntries.map(({ globalIdx, word }) => {
        const selected = isWordInRange(globalIdx, selection);
        const lastEdited = isWordInRange(globalIdx, lastEditedRange);
        return (
          <Box
            as="span"
            key={globalIdx}
            data-global-idx={globalIdx}
            px={0.5}
            mx={-0.5}
            borderRadius="sm"
            cursor="text"
            userSelect="none"
            bg={
              selected
                ? `rgba(${clipperTheme.accentTintRgb},0.35)`
                : lastEdited
                  ? `rgba(${clipperTheme.accentTintRgb},0.25)`
                  : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey && focusIdx != null) {
                setAnchorIdx(anchorIdx ?? focusIdx);
                setFocusIdx(globalIdx);
              } else {
                setAnchorIdx(globalIdx);
                setFocusIdx(globalIdx);
              }
            }}
          >
            {word.text}{" "}
          </Box>
        );
      })}
    </Box>
  );
};
