import { useCallback, useState } from "react";
import { produce } from "immer";

import {
  resolveActiveClipIndexAfterDelete,
  segmentRangeFromTrimmedFile,
  sortClipsByIndex,
  type AutoPartsSegmentLengthSec,
} from "../../engine/segmentation";
import {
  saveClipperClips,
  saveDisabledCollageRegions,
} from "../../persistence/clipper-clips-api.util";
import { syncSessionActiveClips } from "../../pipeline/session.util";
import { clipperError } from "../../shared/logger.util";
import type { ClipSourceMode } from "../../shared/state.util";
import {
  activeClipPreviewsForMode,
  buildClipPreviews,
  clipsToPayload,
  resolveAutoPartsClips,
} from "./clip-preview.util";
import type { UseClipperPipelineCoreResult } from "./use-clipper-pipeline-core.hook";

export function useClipperPipelineClips(core: UseClipperPipelineCoreResult) {
  const {
    projectId,
    setState,
    settings,
    refs,
    persistMetadata,
    autoPartsSegmentLengthSec,
    setAutoPartsSegmentLengthSec,
    setDisabledCollageRegionIds,
    disabledCollageRegionIds,
  } = core;
  const { sessionRef, activeClipIndexRef } = refs;

  const [autoPartsResegmenting, setAutoPartsResegmenting] = useState(false);

  const setClipSourceMode = useCallback(
    (mode: ClipSourceMode) => {
      const session = sessionRef.current;
      if (session) {
        session.clipSourceMode = mode;
        syncSessionActiveClips(session);
      }
      persistMetadata({ clipSourceMode: mode });
      setState((prev) => {
        const previews = activeClipPreviewsForMode(
          mode,
          prev.autoPartsClipPreviews ?? [],
          prev.aiClipPreviews ?? [],
        );
        const nextIndex = Math.min(
          prev.activeClipIndex,
          Math.max(0, previews.length - 1),
        );
        activeClipIndexRef.current = nextIndex;
        if (session) session.activeClipIndex = nextIndex;
        return {
          ...prev,
          clipSourceMode: mode,
          clipPreviews: previews,
          activeClipIndex: nextIndex,
        };
      });
    },
    [activeClipIndexRef, persistMetadata, sessionRef, setState],
  );

  const resegmentAutoParts = useCallback(
    async (
      segmentLengthSec: AutoPartsSegmentLengthSec,
      options: { force?: boolean } = {},
    ) => {
      if (
        !options.force &&
        segmentLengthSec === autoPartsSegmentLengthSec &&
        !autoPartsResegmenting
      ) {
        return;
      }

      const session = sessionRef.current;
      if (!session) return;
      const trimmedFile = session.rangeTrimmedFile ?? session.trimmedFile;
      if (!trimmedFile) return;

      const rangeDuration = session.rangeEnd - session.rangeStart;
      if (rangeDuration <= 0) return;

      setAutoPartsResegmenting(true);
      setState((prev) => ({
        ...prev,
        stageMessage: options.force ? "Resetting clips…" : "Updating clip lengths…",
      }));

      try {
        const wordsPerGroup =
          refs.metadataRef.current.wordsPerGroupAtTranscribe ?? settings.captions.wordsPerGroup;

        if (options.force) {
          session.keyframeTimestamps = undefined;
        }

        const clips = await segmentRangeFromTrimmedFile(
          trimmedFile,
          rangeDuration,
          session.rangeWords,
          wordsPerGroup,
          {
            targetLengthSec: segmentLengthSec,
            onKeyframes: (keyframes) => {
              session.keyframeTimestamps = keyframes;
            },
          },
        );

        session.autoPartsClips = clips;
        syncSessionActiveClips(session);
        session.captionGroupsCache = null;

        const payload = clipsToPayload(clips);
        await saveClipperClips(projectId, "auto-parts", payload);
        persistMetadata({ autoPartsSegmentLengthSec: segmentLengthSec });
        setAutoPartsSegmentLengthSec(segmentLengthSec);

        const autoPartsClipPreviews = buildClipPreviews(clips);
        setState((prev) => {
          const nextIndex = Math.min(
            prev.activeClipIndex,
            Math.max(0, clips.length - 1),
          );
          activeClipIndexRef.current = nextIndex;
          session.activeClipIndex = nextIndex;
          return {
            ...prev,
            autoPartsClipPreviews,
            clipPreviews:
              prev.clipSourceMode === "ai" ? prev.clipPreviews : autoPartsClipPreviews,
            activeClipIndex: nextIndex,
            stageMessage: `Review ${clips.length} clip${clips.length > 1 ? "s" : ""}, then render`,
          };
        });
      } catch (error) {
        clipperError("pipeline: resegment auto-parts failed", error);
        setState((prev) => ({
          ...prev,
          stageMessage:
            error instanceof Error
              ? `Could not update clip lengths: ${error.message}`
              : "Could not update clip lengths.",
        }));
      } finally {
        setAutoPartsResegmenting(false);
      }
    },
    [
      activeClipIndexRef,
      autoPartsResegmenting,
      autoPartsSegmentLengthSec,
      persistMetadata,
      projectId,
      refs.metadataRef,
      sessionRef,
      setAutoPartsSegmentLengthSec,
      setState,
      settings.captions.wordsPerGroup,
    ],
  );

  const deleteAutoPartsClip = useCallback(
    (index: number) => {
      const session = sessionRef.current;
      if (!session) return;

      const previousActive = activeClipIndexRef.current;

      setState((prev) => {
        const currentClips = resolveAutoPartsClips(session, prev);
        if (!currentClips.length) return prev;

        const remaining = sortClipsByIndex(
          currentClips.filter((clip) => clip.index !== index),
        );

        session.autoPartsClips = remaining;
        if (session.clipSourceMode !== "ai") {
          syncSessionActiveClips(session);
        }
        session.captionGroupsCache = null;

        void saveClipperClips(projectId, "auto-parts", clipsToPayload(remaining)).catch((error) =>
          clipperError("pipeline: save auto-parts clips after delete failed", error),
        );

        const nextActive = resolveActiveClipIndexAfterDelete(previousActive, index, remaining);
        activeClipIndexRef.current = nextActive;
        session.activeClipIndex = nextActive;
        void persistMetadata({ activeClipIndex: nextActive });

        const autoPartsClipPreviews = buildClipPreviews(remaining);
        return produce(prev, (draft) => {
          draft.autoPartsClipPreviews = autoPartsClipPreviews;
          draft.clipPreviews =
            draft.clipSourceMode === "ai" ? draft.clipPreviews : autoPartsClipPreviews;
          draft.activeClipIndex = nextActive;
        });
      });
    },
    [activeClipIndexRef, persistMetadata, projectId, sessionRef, setState],
  );

  const toggleCollageRegion = useCallback(
    (regionId: string) => {
      setDisabledCollageRegionIds((prev) => {
        const next = prev.includes(regionId)
          ? prev.filter((id) => id !== regionId)
          : [...prev, regionId];
        const session = sessionRef.current;
        if (session) session.disabledCollageRegionIds = next;
        void saveDisabledCollageRegions(projectId, next).catch((error) =>
          clipperError("pipeline: save collage region overrides failed", error),
        );
        return next;
      });
    },
    [projectId, sessionRef, setDisabledCollageRegionIds],
  );

  return {
    setClipSourceMode,
    resegmentAutoParts,
    deleteAutoPartsClip,
    toggleCollageRegion,
    autoPartsResegmenting,
    disabledCollageRegionIds,
    autoPartsSegmentLengthSec,
  };
}
