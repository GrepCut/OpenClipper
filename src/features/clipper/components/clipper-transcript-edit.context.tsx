import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { TranscriptEditOp, TranscriptWordPatch } from "../engine/transcript";
import {
  loadTranscriptEditHints,
  saveTranscriptEditHints,
  type TranscriptEditHints,
} from "../settings/settings-storage.util";

export interface ClipperTranscriptEditActions {
  applyTranscriptOp: (op: TranscriptEditOp) => TranscriptWordPatch[];
  undoTranscriptEdit: () => boolean;
  redoTranscriptEdit: () => boolean;
}

export interface ClipperTranscriptEditValue extends ClipperTranscriptEditActions {
  hints: TranscriptEditHints;
  markCoachSeen: () => void;
  markUsed: () => void;
}

const ClipperTranscriptEditContext = createContext<ClipperTranscriptEditValue | null>(null);

export function ClipperTranscriptEditProvider({
  actions,
  children,
}: {
  actions: ClipperTranscriptEditActions;
  children: React.ReactNode;
}) {
  const [hints, setHints] = useState(loadTranscriptEditHints);

  const updateHints = useCallback((patch: Partial<TranscriptEditHints>) => {
    setHints((prev) => {
      if (Object.entries(patch).every(([key, value]) => prev[key as keyof TranscriptEditHints] === value)) {
        return prev;
      }
      const next = { ...prev, ...patch };
      saveTranscriptEditHints(next);
      return next;
    });
  }, []);

  const markCoachSeen = useCallback(() => updateHints({ coachSeen: true }), [updateHints]);
  const markUsed = useCallback(() => updateHints({ coachSeen: true, used: true }), [updateHints]);

  const { applyTranscriptOp, undoTranscriptEdit, redoTranscriptEdit } = actions;
  const value = useMemo<ClipperTranscriptEditValue>(
    () => ({
      applyTranscriptOp,
      undoTranscriptEdit,
      redoTranscriptEdit,
      hints,
      markCoachSeen,
      markUsed,
    }),
    [
      applyTranscriptOp,
      hints,
      markCoachSeen,
      markUsed,
      redoTranscriptEdit,
      undoTranscriptEdit,
    ],
  );

  return (
    <ClipperTranscriptEditContext.Provider value={value}>
      {children}
    </ClipperTranscriptEditContext.Provider>
  );
}

/** Transcript editing API, or null outside a session (editing then stays off). */
export function useClipperTranscriptEdit(): ClipperTranscriptEditValue | null {
  return useContext(ClipperTranscriptEditContext);
}
