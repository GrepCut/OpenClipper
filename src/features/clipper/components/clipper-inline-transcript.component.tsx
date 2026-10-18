import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, Text } from "@chakra-ui/react";
import { Columns2 } from "lucide-react";
import type { CollageRegion } from "../engine/types/collage.types";
import type { WordCue } from "../lib/media/transcription-export.util";
import {
  isWordDeleted,
  isPhraseTextUnchanged,
  isWordEdited,
  visibleWordsText,
  type TranscriptEditOp,
} from "../engine/transcript";
import { appToast } from "../../../shared/utils/toast.service";
import { isEditableKeyboardTarget } from "../shared/keyboard-target.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { clipperTheme } from "../shared/theme.util";
import { ClipperTranscriptEmpty } from "./clipper-transcript-empty.component";
import { nearestWordIndexFromPointer } from "./clipper-transcript-word-pointer.util";
import { useClipperTranscriptEdit } from "./clipper-transcript-edit.context";
import {
  ClipperTranscriptWordInput,
  type TranscriptWordInputMove,
} from "./clipper-transcript-word-input.component";
import { ClipperTranscriptSelectionToolbar } from "./clipper-transcript-selection-toolbar.component";

export interface ClipperInlineTranscriptProps {
  words: WordCue[];
  wordTimeOffsetSec: number;
  regions: CollageRegion[];
  disabledRegionIds: string[];
  onToggleRegion: (regionId: string) => void;
  showCollageMarkers?: boolean;
  emptyMessage?: string;
  onWordClick?: (absoluteTimeSec: number) => void;
  /** `rangeWords` index of each entry in `words` (-1 = unmatched); enables editing. */
  rangeIndices?: number[];
}

interface WordSelection {
  anchor: number;
  focus: number;
}

interface WordEditing {
  positions: number[];
  initialText: string;
  selectAll: boolean;
}

const TOOLBAR_OFFSET_PX = 34;
const TOOLBAR_MAX_WIDTH_PX = 300;

function wordAbsoluteTimeSec(word: WordCue, wordTimeOffsetSec: number): number {
  return word.start + wordTimeOffsetSec;
}

/** Maps each region to the first word it overlaps, so its marker renders inline at the right spot. */
function regionsByWordIndex(
  words: WordCue[],
  regions: CollageRegion[],
  wordTimeOffsetSec = 0,
): Map<number, CollageRegion[]> {
  const map = new Map<number, CollageRegion[]>();
  for (const region of regions) {
    let index = words.findIndex(
      (w) => w.end + wordTimeOffsetSec > region.start,
    );
    if (index === -1) index = Math.max(0, words.length - 1);
    const existing = map.get(index);
    if (existing) existing.push(region);
    else map.set(index, [region]);
  }
  return map;
}

export function filterRegionsForClip(
  regions: CollageRegion[],
  clipStartSec: number,
  clipEndSec: number,
): CollageRegion[] {
  return regions.filter(
    (region) => region.end > clipStartSec && region.start < clipEndSec,
  );
}

function selectionPositions(selection: WordSelection | null): number[] {
  if (!selection) return [];
  const from = Math.min(selection.anchor, selection.focus);
  const to = Math.max(selection.anchor, selection.focus);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function wordPositionFromTarget(
  target: EventTarget | null,
  container: HTMLElement | null,
): number | null {
  if (!(target instanceof Element) || !container) return null;
  const element = target.closest("[data-word-index]");
  if (!element || !container.contains(element)) return null;
  const index = Number(element.getAttribute("data-word-index"));
  return Number.isInteger(index) ? index : null;
}

function wordTitle(
  word: WordCue,
  showUsageHint: boolean,
): string | undefined {
  if (isWordDeleted(word)) return "Removed from captions. Click it, then Restore";
  if (isWordEdited(word)) return `Originally: "${word.originalText}"`;
  return showUsageHint ? "Click to jump · Double-click to edit" : undefined;
}

function SplitRegionMarker({
  region,
  enabled,
  onToggle,
  inline,
  onBrand,
  muted,
}: {
  region: CollageRegion;
  enabled: boolean;
  onToggle: (regionId: string) => void;
  inline?: boolean;
  onBrand: string;
  muted: string;
}) {
  return (
    <IconButton
      key={region.id}
      aria-label={
        enabled
          ? "Two speakers detected. Split-screen on here, click to turn off for this part."
          : "Split-screen turned off for this part. Click to turn back on."
      }
      title={
        enabled
          ? "Split-screen on here. Click to turn off"
          : "Split-screen off here. Click to turn on"
      }
      size="2xs"
      variant={enabled ? "solid" : "outline"}
      bg={enabled ? clipperTheme.accent : undefined}
      color={enabled ? onBrand : muted}
      borderRadius="full"
      w="22px"
      h="22px"
      minW="22px"
      minH="22px"
      p={0}
      flexShrink={0}
      mx={inline ? 1 : undefined}
      verticalAlign={inline ? "middle" : undefined}
      transition="background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease"
      _hover={
        enabled
          ? {
              bg: clipperTheme.accentHover,
              opacity: 0.92,
            }
          : {
              bg: `rgba(${clipperTheme.accentTintRgb},0.12)`,
              borderColor: clipperTheme.accent,
              color: clipperTheme.accentLight,
            }
      }
      onClick={(e) => {
        e.stopPropagation();
        onToggle(region.id);
      }}
    >
      <Columns2 size={12} />
    </IconButton>
  );
}

export const ClipperInlineTranscript: React.FC<
  ClipperInlineTranscriptProps
> = ({
  words,
  wordTimeOffsetSec,
  regions,
  disabledRegionIds,
  onToggleRegion,
  showCollageMarkers = true,
  emptyMessage = "No speech detected in this range.",
  onWordClick,
  rangeIndices,
}) => {
  const { theme } = useClipperUi();
  const edit = useClipperTranscriptEdit();
  const editable = Boolean(edit && rangeIndices && rangeIndices.length === words.length);
  const disabledSet = useMemo(
    () => new Set(disabledRegionIds),
    [disabledRegionIds],
  );
  const transcriptRef = useRef<HTMLParagraphElement>(null);
  const markersByWordIndex = useMemo(
    () =>
      showCollageMarkers
        ? regionsByWordIndex(words, regions, wordTimeOffsetSec)
        : new Map<number, CollageRegion[]>(),
    [words, regions, wordTimeOffsetSec, showCollageMarkers],
  );

  const [selection, setSelection] = useState<WordSelection | null>(null);
  const [editing, setEditing] = useState<WordEditing | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const dragRef = useRef<{ anchor: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!isSelecting) return;
    const endDrag = () => {
      if (dragRef.current?.moved) suppressClickRef.current = true;
      dragRef.current = null;
      setIsSelecting(false);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, [isSelecting]);

  const selected = useMemo(
    () =>
      selectionPositions(selection).filter(
        (position) => words[position] && (rangeIndices?.[position] ?? -1) >= 0,
      ),
    [rangeIndices, selection, words],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Positions index into `words`; once the list is rebuilt they point at different words.
  useEffect(() => {
    setSelection(null);
    setEditing(null);
  }, [words.length]);

  const hasSelection = selection != null;
  useEffect(() => {
    if (!hasSelection || editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isEditableKeyboardTarget(event.target)) return;
      event.stopPropagation();
      setSelection(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hasSelection, editing]);

  useLayoutEffect(() => {
    const container = transcriptRef.current;
    const first =
      container && selected.length && !editing
        ? container.querySelector(`[data-word-index="${selected[0]}"]`)
        : null;
    if (!container || !first) {
      setToolbarPos(null);
      return;
    }
    const wordRect = first.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const maxLeft = Math.max(0, containerRect.width - TOOLBAR_MAX_WIDTH_PX);
    setToolbarPos({
      top: wordRect.top - containerRect.top - TOOLBAR_OFFSET_PX,
      left: Math.min(Math.max(0, wordRect.left - containerRect.left - 4), maxLeft),
    });
  }, [editing, selected, words]);

  const toIndices = useCallback(
    (positions: number[]) =>
      positions
        .map((position) => rangeIndices?.[position] ?? -1)
        .filter((index) => index >= 0),
    [rangeIndices],
  );

  const focusTranscript = () => transcriptRef.current?.focus({ preventScroll: true });

  const runOp = (op: TranscriptEditOp, removedCount = 0): boolean => {
    if (!edit) return false;
    const patches = edit.applyTranscriptOp(op);
    if (!patches.length) return false;
    edit.markUsed();
    if (removedCount > 0) {
      appToast.info(
        `Removed ${removedCount} word${removedCount === 1 ? "" : "s"} from captions`,
        undefined,
        { action: { label: "Undo", onClick: () => edit.undoTranscriptEdit() } },
      );
    }
    return true;
  };

  const startEdit = (positions: number[], typed?: string) => {
    const editablePositions = positions.filter(
      (position) => words[position] && (rangeIndices?.[position] ?? -1) >= 0,
    );
    if (!editablePositions.length) return;
    const phrase = editablePositions.map((position) => words[position]!);
    const initialText =
      visibleWordsText(phrase) || phrase.map((word) => word.text).join(" ");
    setSelection(null);
    setEditing({
      positions: editablePositions,
      initialText: typed ?? initialText,
      selectAll: typed == null,
    });
  };

  const nextEditablePosition = (from: number, step: 1 | -1): number | null => {
    for (let position = from; position >= 0 && position < words.length; position += step) {
      if (!isWordDeleted(words[position]!) && (rangeIndices?.[position] ?? -1) >= 0) {
        return position;
      }
    }
    return null;
  };

  const commitEdit = (text: string, move: TranscriptWordInputMove) => {
    const current = editing;
    setEditing(null);
    if (!current) return;
    const positions = current.positions.filter((position) => words[position]);
    const indices = toIndices(positions);
    const phrase = positions.map((position) => words[position]!);
    // Opening and closing the editor on a phrase must never merge, restore or reshuffle words.
    if (indices.length && !isPhraseTextUnchanged(phrase, text)) {
      const removed = text.trim()
        ? 0
        : phrase.filter((word) => !isWordDeleted(word)).length;
      runOp(
        indices.length === 1
          ? { kind: "setText", index: indices[0]!, text }
          : { kind: "replacePhrase", indices, text },
        removed,
      );
    }
    if (move !== 0) {
      const edge =
        move > 0 ? Math.max(...current.positions) + 1 : Math.min(...current.positions) - 1;
      const next = nextEditablePosition(edge, move);
      if (next != null) {
        setEditing({ positions: [next], initialText: words[next]!.text, selectAll: true });
        return;
      }
    }
    focusTranscript();
  };

  const cancelEdit = () => {
    setEditing(null);
    focusTranscript();
  };

  const deleteSelected = () => {
    const live = selected.filter((position) => !isWordDeleted(words[position]!));
    if (!live.length) return;
    runOp({ kind: "delete", indices: toIndices(live) }, live.length);
    setSelection(null);
  };

  const restoreSelected = () => {
    runOp({ kind: "restore", indices: toIndices(selected) });
    setSelection(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    // While an input is open, let the default focus change blur (and so commit) it.
    if (!editable || editing || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    const position = wordPositionFromTarget(event.target, transcriptRef.current);
    if (position == null) return;
    event.preventDefault();
    focusTranscript();
    if (event.shiftKey && selection) {
      setSelection({ anchor: selection.anchor, focus: position });
      suppressClickRef.current = true;
      return;
    }
    dragRef.current = { anchor: position, moved: false };
    setIsSelecting(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const position = wordPositionFromTarget(event.target, transcriptRef.current);
    if (position == null || (position === drag.anchor && !drag.moved)) return;
    drag.moved = true;
    setSelection({ anchor: drag.anchor, focus: position });
  };

  const handleTranscriptClick = (event: React.MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button"))
      return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.stopPropagation();
      return;
    }

    const nearestWordIndex = nearestWordIndexFromPointer(
      transcriptRef.current,
      event,
      "data-word-index",
      (index) => Boolean(words[index]),
    );
    if (nearestWordIndex == null) return;
    event.stopPropagation();
    onWordClick?.(
      wordAbsoluteTimeSec(words[nearestWordIndex], wordTimeOffsetSec),
    );
    if (!editable) return;

    if (isWordDeleted(words[nearestWordIndex]!)) {
      let anchor = nearestWordIndex;
      let focus = nearestWordIndex;
      while (anchor > 0 && isWordDeleted(words[anchor - 1]!)) anchor--;
      while (focus < words.length - 1 && isWordDeleted(words[focus + 1]!)) focus++;
      setSelection({ anchor, focus });
    } else {
      setSelection(null);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    const position = wordPositionFromTarget(event.target, transcriptRef.current);
    if (position == null) return;
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    startEdit(selected.length > 1 && selectedSet.has(position) ? selected : [position]);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (editing || isEditableKeyboardTarget(event.target)) return;
    if (event.key === "Escape") {
      if (selected.length) setSelection(null);
      else return;
      event.stopPropagation();
      return;
    }
    if (!selected.length) return;
    const typed =
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (event.key === "Delete" || event.key === "Backspace") {
      deleteSelected();
    } else if (event.key === "Enter" || event.key === "F2") {
      startEdit(selected);
    } else if (typed && selected.length === 1) {
      startEdit(selected, event.key);
    } else if (event.key !== " ") {
      return;
    }
    // Space is swallowed too, so it doesn't select the whole card while words are selected.
    event.preventDefault();
    event.stopPropagation();
  };

  if (words.length === 0) {
    if (!showCollageMarkers || regions.length === 0) {
      return <ClipperTranscriptEmpty message={emptyMessage} />;
    }
    return (
      <Box>
        <ClipperTranscriptEmpty message={emptyMessage} />
        <Box mt={1} display="flex" flexWrap="wrap" gap={1}>
          {regions.map((region) => (
            <SplitRegionMarker
              key={region.id}
              region={region}
              enabled={!disabledSet.has(region.id)}
              onToggle={onToggleRegion}
              onBrand={theme.text.onBrand}
              muted={theme.text.muted}
            />
          ))}
        </Box>
      </Box>
    );
  }

  const interactive = Boolean(onWordClick) || editable;
  const editingStart = editing ? Math.min(...editing.positions) : -1;
  const editingSet = new Set(editing?.positions ?? []);
  const selectedHasLive = selected.some((position) => !isWordDeleted(words[position]!));
  const selectedHasDeleted = selected.some((position) => isWordDeleted(words[position]!));
  const showUsageHint = editable && !edit?.hints.used;

  return (
    <Box position="relative">
      <Text
        ref={transcriptRef}
        fontSize="sm"
        color={theme.text.onBrandMuted}
        lineHeight="1.8"
        tabIndex={editable ? 0 : undefined}
        outline="none"
        cursor={isSelecting ? "text" : undefined}
        onClick={interactive ? handleTranscriptClick : undefined}
        onDoubleClick={editable ? handleDoubleClick : undefined}
        onPointerDown={editable ? handlePointerDown : undefined}
        onPointerMove={editable ? handlePointerMove : undefined}
        onKeyDown={editable ? handleKeyDown : undefined}
        aria-label={
          editable
            ? "Transcript. Click a word to jump to it, double-click to edit it, or select words and press Delete to remove them from captions."
            : onWordClick
              ? "Click transcript to seek to the nearest word"
              : undefined
        }
        css={
          interactive
            ? {
                ...(editable ? { userSelect: "none" } : {}),
                "& [data-word-index]": {
                  transition: "color 100ms ease-out, background 100ms ease-out",
                  borderRadius: "3px",
                },
                "& [data-deleted]": {
                  textDecoration: "line-through",
                  opacity: 0.4,
                },
                "& [data-selected]": {
                  background: `rgba(${clipperTheme.accentTintRgb},0.3)`,
                  color: theme.text.primary,
                },
                "@media (hover: hover)": {
                  "& [data-word-index]:hover": {
                    color: clipperTheme.accentLight,
                  },
                },
              }
            : undefined
        }
      >
        {words.map((word, index) => {
          if (editingSet.has(index) && index !== editingStart) return null;
          const markers = markersByWordIndex.get(index);
          return (
            <React.Fragment key={index}>
              {markers?.map((region) => (
                <SplitRegionMarker
                  key={region.id}
                  region={region}
                  enabled={!disabledSet.has(region.id)}
                  onToggle={onToggleRegion}
                  inline
                  onBrand={theme.text.onBrand}
                  muted={theme.text.muted}
                />
              ))}
              {editing && index === editingStart ? (
                <ClipperTranscriptWordInput
                  initialText={editing.initialText}
                  selectAll={editing.selectAll}
                  onCommit={commitEdit}
                  onCancel={cancelEdit}
                />
              ) : interactive ? (
                <span
                  data-word-index={index}
                  data-deleted={isWordDeleted(word) || undefined}
                  data-selected={selectedSet.has(index) || undefined}
                  title={editable ? wordTitle(word, showUsageHint) : undefined}
                >
                  {word.text}
                </span>
              ) : (
                word.text
              )}{" "}
            </React.Fragment>
          );
        })}
      </Text>
      {toolbarPos && editable ? (
        <ClipperTranscriptSelectionToolbar
          top={toolbarPos.top}
          left={toolbarPos.left}
          canEdit={selectedHasLive}
          canDelete={selectedHasLive}
          canRestore={selectedHasDeleted}
          onEdit={() => startEdit(selected)}
          onDelete={deleteSelected}
          onRestore={restoreSelected}
        />
      ) : null}
    </Box>
  );
};
