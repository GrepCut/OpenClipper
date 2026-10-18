import React, { useEffect, useRef } from "react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export type TranscriptWordInputMove = -1 | 0 | 1;

export interface ClipperTranscriptWordInputProps {
  initialText: string;
  /** Select the whole text on mount (false = caret at the end, e.g. after a typed character). */
  selectAll: boolean;
  onCommit: (text: string, move: TranscriptWordInputMove) => void;
  onCancel: () => void;
}

/**
 * Inline editor that replaces a word (or phrase) in place. It is a contentEditable span rather than
 * an <input> so a phrase that wraps over several lines keeps its place in the text.
 */
export function ClipperTranscriptWordInput({
  initialText,
  selectAll,
  onCommit,
  onCancel,
}: ClipperTranscriptWordInputProps) {
  const { theme } = useClipperUi();
  const ref = useRef<HTMLSpanElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.textContent = initialText;
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    if (!selectAll) range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Mount-only: re-running would reset the text and caret while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readValue = () => (ref.current?.textContent ?? "").replace(/\s+/g, " ");

  const finish = (action: () => void) => {
    if (doneRef.current) return;
    doneRef.current = true;
    action();
  };

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label="Edit word"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={() => finish(() => onCommit(readValue(), 0))}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(() => onCommit(readValue(), 0));
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(onCancel);
        } else if (event.key === "Tab") {
          event.preventDefault();
          finish(() => onCommit(readValue(), event.shiftKey ? -1 : 1));
        }
      }}
      style={{
        display: "inline",
        minWidth: "2ch",
        font: "inherit",
        lineHeight: "inherit",
        color: theme.text.primary,
        background: `rgba(${clipperTheme.accentTintRgb},0.16)`,
        border: `1px solid ${clipperTheme.accent}`,
        borderRadius: 4,
        padding: "0 3px",
        outline: "none",
        whiteSpace: "pre-wrap",
        cursor: "text",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      }}
    />
  );
}
