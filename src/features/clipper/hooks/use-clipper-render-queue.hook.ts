import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scheduleRenderQueueSave } from "../persistence/render-queue-autosave.util";
import { saveLastRenderQueueFormatIds } from "../settings/settings-storage.util";
import { CLIPPER_FORMAT_DEFS } from "../shared/formats.util";
import {
  buildRenderQueueSnapshot,
  deriveRenderQueueFormatTemplate,
  hydrateRenderQueueSelections,
  resolveClipFormatIds,
} from "../shared/render-queue-utils.util";
import type { SessionViewMode } from "../shared/clipper-session-view.types";
import type { ClipperLoadedProject } from "./use-clipper-project-loader.hook";
import type { ClipperClipPreview } from "../shared/state.util";

export interface UseClipperRenderQueueOptions {
  projectId: string;
  loaded: ClipperLoadedProject | null;
  clipIndices: number[];
  clipPreviews: ClipperClipPreview[];
  isRendering: boolean;
  view: SessionViewMode;
  setView: (view: SessionViewMode) => void;
  renderExports: (formatIdsByClip: Record<number, string[]>) => Promise<boolean>;
}

export function useClipperRenderQueue({
  projectId,
  loaded,
  clipIndices,
  clipPreviews,
  setView,
  renderExports,
}: UseClipperRenderQueueOptions) {
  const [clipFormatSelections, setClipFormatSelections] = useState<Record<number, string[]>>({});
  const skipRenderQueueSaveRef = useRef(true);
  const renderQueueHydratedRef = useRef(false);
  const clipsReadyForQueueRef = useRef(false);

  useEffect(() => {
    renderQueueHydratedRef.current = false;
    clipsReadyForQueueRef.current = false;
    skipRenderQueueSaveRef.current = true;
  }, [projectId]);

  useEffect(() => {
    if (!loaded) return;

    const clipsReady = clipIndices.length > 0;
    const shouldHydrate =
      !renderQueueHydratedRef.current || (!clipsReadyForQueueRef.current && clipsReady);

    if (!shouldHydrate) return;

    skipRenderQueueSaveRef.current = true;
    setClipFormatSelections(
      hydrateRenderQueueSelections(
        loaded.renderQueueFormats,
        clipsReady ? clipIndices : [],
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

    const snapshot = buildRenderQueueSnapshot(clipIndices, clipFormatSelections);
    scheduleRenderQueueSave(projectId, snapshot);
    const template = deriveRenderQueueFormatTemplate(snapshot);
    if (template.length > 0) {
      saveLastRenderQueueFormatIds(template);
    }
  }, [clipFormatSelections, clipIndices, loaded, projectId]);

  const getClipFormatIds = useCallback(
    (clipIndex: number): string[] => resolveClipFormatIds(clipIndex, clipFormatSelections),
    [clipFormatSelections],
  );

  const toggleClipFormat = useCallback((clipIndex: number, formatId: string) => {
    setClipFormatSelections((prev) => {
      const current = resolveClipFormatIds(clipIndex, prev);
      const next = current.includes(formatId)
        ? current.filter((id) => id !== formatId)
        : [...current, formatId];
      return { ...prev, [clipIndex]: next };
    });
  }, []);

  const setFormatForAllClips = useCallback(
    (formatId: string, enabled: boolean) => {
      setClipFormatSelections((prev) => {
        const next: Record<number, string[]> = { ...prev };
        for (const p of clipPreviews) {
          const clipIndex = p.clip.index;
          const current = resolveClipFormatIds(clipIndex, prev);
          next[clipIndex] = enabled
            ? current.includes(formatId)
              ? current
              : [...current, formatId]
            : current.filter((id) => id !== formatId);
        }
        return next;
      });
    },
    [clipPreviews],
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
    setView("queue");
  }, [setView]);

  const startQueuedRender = useCallback(() => {
    setView("rendering");
    void (async () => {
      const started = await renderExports(formatIdsByClip);
      if (!started) {
        setView("queue");
      }
    })();
  }, [formatIdsByClip, renderExports, setView]);

  return {
    getClipFormatIds,
    toggleClipFormat,
    setFormatForAllClips,
    setAllFormatsForClip,
    formatIdsByClip,
    openRenderQueue,
    startQueuedRender,
  };
}
