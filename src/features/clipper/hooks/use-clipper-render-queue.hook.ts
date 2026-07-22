import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scheduleRenderQueueSave } from "../persistence/render-queue-autosave.util";
import { CLIPPER_FORMAT_DEFS } from "../shared/formats.util";
import {
  buildRenderQueueSnapshot,
  resolveClipFormatIds,
  sanitizeRenderQueueSelections,
} from "../shared/render-queue-utils.util";
import type { QueuePhase } from "../shared/clipper-session-view.types";
import type { ClipperLoadedProject } from "./use-clipper-project-loader.hook";
import type { ClipperClipPreview } from "../shared/state.util";

export interface UseClipperRenderQueueOptions {
  projectId: string;
  loaded: ClipperLoadedProject | null;
  clipIndices: number[];
  clipPreviews: ClipperClipPreview[];
  enabledFormatIds: string[];
  isRendering: boolean;
  sessionResultsLength: number;
  view: "preview" | "queue" | "exports";
  setView: (view: "preview" | "queue" | "exports") => void;
  renderExports: (formatIdsByClip: Record<number, string[]>) => Promise<void>;
}

export function useClipperRenderQueue({
  projectId,
  loaded,
  clipIndices,
  clipPreviews,
  enabledFormatIds,
  isRendering,
  sessionResultsLength,
  view,
  setView,
  renderExports,
}: UseClipperRenderQueueOptions) {
  const [queuePhase, setQueuePhase] = useState<QueuePhase>("setup");
  const [clipFormatSelections, setClipFormatSelections] = useState<Record<number, string[]>>({});
  const skipRenderQueueSaveRef = useRef(true);
  const renderQueueHydratedRef = useRef(false);
  const clipsReadyForQueueRef = useRef(false);

  useEffect(() => {
    renderQueueHydratedRef.current = false;
    clipsReadyForQueueRef.current = false;
    skipRenderQueueSaveRef.current = true;
    setQueuePhase("setup");
  }, [projectId]);

  useEffect(() => {
    if (queuePhase === "progress" && !isRendering && sessionResultsLength > 0) {
      setQueuePhase("complete");
    }
  }, [isRendering, queuePhase, sessionResultsLength]);

  useEffect(() => {
    if (view === "queue" && isRendering) {
      setQueuePhase("progress");
    }
  }, [isRendering, view]);

  useEffect(() => {
    if (!loaded) return;

    const clipsReady = clipIndices.length > 0;
    const shouldHydrate =
      !renderQueueHydratedRef.current || (!clipsReadyForQueueRef.current && clipsReady);

    if (!shouldHydrate) return;

    skipRenderQueueSaveRef.current = true;
    setClipFormatSelections(
      sanitizeRenderQueueSelections(
        loaded.renderQueueFormats,
        clipsReady ? clipIndices : undefined,
      ),
    );
    renderQueueHydratedRef.current = true;
    if (clipsReady) clipsReadyForQueueRef.current = true;
  }, [clipIndices, loaded, projectId]);

  useEffect(() => {
    if (!loaded || skipRenderQueueSaveRef.current) {
      skipRenderQueueSaveRef.current = false;
      return;
    }
    if (clipIndices.length === 0) return;

    const snapshot = buildRenderQueueSnapshot(
      clipIndices,
      clipFormatSelections,
      enabledFormatIds,
    );
    scheduleRenderQueueSave(projectId, snapshot);
  }, [clipFormatSelections, clipIndices, loaded, projectId, enabledFormatIds]);

  const getClipFormatIds = useCallback(
    (clipIndex: number): string[] =>
      resolveClipFormatIds(clipIndex, clipFormatSelections, enabledFormatIds),
    [clipFormatSelections, enabledFormatIds],
  );

  const toggleClipFormat = useCallback(
    (clipIndex: number, formatId: string) => {
      setClipFormatSelections((prev) => {
        const current = resolveClipFormatIds(clipIndex, prev, enabledFormatIds);
        const next = current.includes(formatId)
          ? current.filter((id) => id !== formatId)
          : [...current, formatId];
        return { ...prev, [clipIndex]: next };
      });
    },
    [enabledFormatIds],
  );

  const setFormatForAllClips = useCallback(
    (formatId: string, enabled: boolean) => {
      setClipFormatSelections((prev) => {
        const next: Record<number, string[]> = { ...prev };
        for (const p of clipPreviews) {
          const clipIndex = p.clip.index;
          const current = resolveClipFormatIds(clipIndex, prev, enabledFormatIds);
          next[clipIndex] = enabled
            ? current.includes(formatId)
              ? current
              : [...current, formatId]
            : current.filter((id) => id !== formatId);
        }
        return next;
      });
    },
    [enabledFormatIds, clipPreviews],
  );

  const setAllFormatsForClip = useCallback((clipIndex: number, enabled: boolean) => {
    setClipFormatSelections((prev) => ({
      ...prev,
      [clipIndex]: enabled ? CLIPPER_FORMAT_DEFS.map((def) => def.id) : [],
    }));
  }, []);

  const formatIdsByClip = useMemo(
    () =>
      Object.fromEntries(
        clipPreviews.map((p) => [p.clip.index, getClipFormatIds(p.clip.index)]),
      ) as Record<number, string[]>,
    [clipPreviews, getClipFormatIds],
  );

  const openRenderQueue = useCallback(() => {
    setQueuePhase("setup");
    setView("queue");
  }, [setView]);

  const startQueuedRender = useCallback(() => {
    setQueuePhase("progress");
    setView("queue");
    void renderExports(formatIdsByClip);
  }, [formatIdsByClip, renderExports, setView]);

  return {
    queuePhase,
    getClipFormatIds,
    toggleClipFormat,
    setFormatForAllClips,
    setAllFormatsForClip,
    formatIdsByClip,
    openRenderQueue,
    startQueuedRender,
  };
}
