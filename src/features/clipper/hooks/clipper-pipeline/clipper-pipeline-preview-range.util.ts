import {
  autoPartsBoundariesEqual,
  normalizeAutoPartsSegmentLengthSec,
  repairAutoPartsBoundaries,
} from "../../engine/segmentation";
import {
  fetchClipperClips,
  fetchDisabledCollageRegions,
  saveClipperClips,
} from "../../persistence/clipper-clips-api.util";
import { saveClipperRangeWords } from "../../persistence/clipper-range-words-api.util";
import {
  canUseFastPreviewResume,
  runFastPreviewResume,
} from "../../pipeline/fast-resume.util";
import { runPreparePreviewPipeline } from "../../pipeline/range-workflow.util";
import { syncSessionActiveClips, type ClipperSession } from "../../pipeline/session.util";
import { clipperError, clipperLog } from "../../shared/logger.util";
import type { WordCue } from "../../lib/media/transcription-export.util";
import type { PipelineReporter } from "../../pipeline/reporter.util";
import type { ClipperProjectMetadata } from "../../persistence/project-metadata.util";
import type { ClipperPipelineState, ClipperFormatResult } from "../../shared/state.util";
import type { ClipperSettings } from "../../settings/settings.util";
import { captionWordsPerGroup } from "../../lib/captions/caption-presets.util";
import {
  activeClipPreviewsForMode,
  buildClipPreviews,
  clipsToPayload,
  rebuildClipsFromDbPayload,
} from "./clip-preview.util";
import {
  buildEarlyPreviewStatePatch,
  mergeEarlyPreviewPatch,
} from "./early-preview-hydrate.util";

export interface PreparePreviewFromRangeDeps {
  settings: ClipperSettings;
  metadataRef: React.MutableRefObject<ClipperProjectMetadata>;
  aiClipsMetaRef: React.MutableRefObject<Awaited<ReturnType<typeof fetchClipperClips>>>;
  manualClipsMetaRef: React.MutableRefObject<Awaited<ReturnType<typeof fetchClipperClips>>>;
  activeClipIndexRef: React.MutableRefObject<number>;
  reporterRef: React.MutableRefObject<PipelineReporter>;
  persistMetadata: (
    patch: Partial<ClipperProjectMetadata>,
    stage?: ClipperProjectMetadata["stage"],
  ) => Promise<void>;
  setDisabledCollageRegionIds: (ids: string[]) => void;
  setAutoPartsSegmentLengthSec: (length: number) => void;
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>;
  hydrateExportsFromDisk: () => Promise<ClipperFormatResult[]>;
}

export async function preparePreviewFromRange(
  deps: PreparePreviewFromRangeDeps,
  session: ClipperSession,
  snappedStart: number,
  end: number,
  words: WordCue[],
  controller: AbortController,
  runId: string,
  options: {
    skipFaceDetect?: boolean;
    skipSubjectAnalysis?: boolean;
    skipTrim?: boolean;
    projectId: string;
    mediaFileId: string;
  },
): Promise<void> {
  const {
    settings,
    metadataRef,
    aiClipsMetaRef,
    manualClipsMetaRef,
    activeClipIndexRef,
    reporterRef,
    persistMetadata,
    setDisabledCollageRegionIds,
    setAutoPartsSegmentLengthSec,
    setState,
    hydrateExportsFromDisk,
  } = deps;

  const wordsPerGroup = captionWordsPerGroup(settings.captions);
  const metadata = metadataRef.current;
  const rangeDuration = end - snappedStart;
  const segmentLength = normalizeAutoPartsSegmentLengthSec(metadata.autoPartsSegmentLengthSec);

  const [autoPartsDbClips, aiDbClips, manualDbClips, fetchedDisabledRegionIds] = await Promise.all([
    fetchClipperClips(options.projectId, "auto-parts").catch(() => []),
    fetchClipperClips(options.projectId, "ai").catch(() => []),
    fetchClipperClips(options.projectId, "manual").catch(() => []),
    fetchDisabledCollageRegions(options.projectId).catch(() => []),
  ]);
  aiClipsMetaRef.current = aiDbClips;
  manualClipsMetaRef.current = manualDbClips;
  session.disabledCollageRegionIds = fetchedDisabledRegionIds;
  setDisabledCollageRegionIds(fetchedDisabledRegionIds);

  const repairedGenerated = repairAutoPartsBoundaries(rangeDuration, autoPartsDbClips, segmentLength);
  const clipsForResume = repairedGenerated.length > 0 ? repairedGenerated : autoPartsDbClips;
  const needsRepairSave =
    repairedGenerated.length > 0 && !autoPartsBoundariesEqual(autoPartsDbClips, repairedGenerated);
  if (needsRepairSave) {
    void saveClipperClips(
      options.projectId,
      "auto-parts",
      repairedGenerated.map((clip) => ({
        index: clip.index,
        startSec: clip.startSec,
        endSec: clip.endSec,
        segments: [{ orderIndex: 0, startSec: clip.startSec, endSec: clip.endSec }],
      })),
    ).catch((error) => clipperError(`pipeline[${runId}]: repair auto-parts clips failed`, error));
  }
  if (words.length > 0) {
    void saveClipperRangeWords(options.projectId, words).catch((error) =>
      clipperError(`pipeline[${runId}]: save range words failed`, error),
    );
  }

  const resolveClipSourceMode = () => {
    const mode = session.clipSourceMode ?? metadataRef.current.clipSourceMode ?? "auto-parts";
    return mode === "manual" && manualDbClips.length === 0 ? "auto-parts" : mode;
  };

  const earlyPatch = buildEarlyPreviewStatePatch({
    clipsForResume,
    aiDbClips,
    manualDbClips,
    words,
    wordsPerGroup,
    rangeDuration,
    clipSourceMode: resolveClipSourceMode(),
    activeClipIndex: metadataRef.current.activeClipIndex ?? activeClipIndexRef.current ?? 0,
    snappedStart,
    end,
  });
  if (earlyPatch) setState((prev) => mergeEarlyPreviewPatch(prev, earlyPatch));

  const useFastPath =
    clipsForResume.length > 0 &&
    canUseFastPreviewResume(clipsForResume, options.skipTrim ?? false, snappedStart, end);
  clipperLog(`pipeline[${runId}]: resume path`, {
    path: useFastPath ? "fast-path" : "full-pipeline",
    repaired: needsRepairSave,
  });

  const pipelineInput = {
    projectId: options.projectId,
    mediaFileId: options.mediaFileId,
    snappedStart,
    end,
    words,
    wordsPerGroup,
    targetLengthSec: segmentLength,
    enabledFormatIds: settings.formats.enabledFormatIds,
    skipFaceDetect: options.skipFaceDetect,
    skipSubjectAnalysis: options.skipSubjectAnalysis,
    skipTrim: options.skipTrim,
    runId,
  };

  const result = useFastPath
    ? await runFastPreviewResume(
        session,
        {
          ...pipelineInput,
          generatedClips: clipsForResume,
        },
        reporterRef.current,
        { signal: controller.signal },
      )
    : await runPreparePreviewPipeline(
        session,
        pipelineInput,
        reporterRef.current,
        { signal: controller.signal },
      );
  if (controller.signal.aborted) return;

  const generatedClips = clipsToPayload(result.clips, words, rangeDuration);
  void saveClipperClips(options.projectId, "auto-parts", generatedClips).catch((error) =>
    clipperError(`pipeline[${runId}]: save auto-parts clips failed`, error),
  );

  const restoredActiveClipIndex =
    metadataRef.current.activeClipIndex ?? activeClipIndexRef.current ?? 0;
  await persistMetadata(
    {
      clipStart: snappedStart,
      clipEnd: end,
      transcribedClipStart: snappedStart,
      transcribedClipEnd: end,
      autoPartsSegmentLengthSec: segmentLength,
      activeClipIndex: restoredActiveClipIndex,
    },
    "preview",
  );
  setAutoPartsSegmentLengthSec(segmentLength);

  const clipSourceMode = resolveClipSourceMode();
  const autoPartsClipPreviews = buildClipPreviews(result.clips);
  session.autoPartsClips = result.clips;
  session.aiClips = rebuildClipsFromDbPayload(
    aiDbClips,
    words,
    wordsPerGroup,
    session.rangeEnd - session.rangeStart,
    session.audioEnvelope ?? undefined,
  );
  session.manualClips = rebuildClipsFromDbPayload(
    manualDbClips,
    words,
    wordsPerGroup,
    session.rangeEnd - session.rangeStart,
    session.audioEnvelope ?? undefined,
  );
  session.clipSourceMode = clipSourceMode;
  syncSessionActiveClips(session);

  const aiClipPreviews = buildClipPreviews(session.aiClips);
  const manualClipPreviews = buildClipPreviews(session.manualClips);
  const clipPreviews = activeClipPreviewsForMode(
    clipSourceMode,
    autoPartsClipPreviews,
    aiClipPreviews,
    manualClipPreviews,
  );
  const validActiveClipIndex = clipPreviews.some((p) => p.clip.index === restoredActiveClipIndex)
    ? restoredActiveClipIndex
    : clipPreviews[0]?.clip.index ?? 0;
  activeClipIndexRef.current = validActiveClipIndex;
  session.activeClipIndex = validActiveClipIndex;

  const metaStage = metadataRef.current.stage;
  const done = metaStage === "done";
  clipperLog(`pipeline[${runId}]: post-face — enter preview`, {
    rangeDuration: result.rangeDuration,
    clipCount: result.clips.length,
  });
  setState((prev) => ({
    ...prev,
    stage: done ? "done" : "preview",
    stageMessage: done
      ? "Your clips are ready!"
      : `Review ${result.clips.length} clip${result.clips.length > 1 ? "s" : ""}, then render`,
    rangeTrimmedVideoUrl: result.rangeTrimmedVideoUrl,
    clipPreviews,
    autoPartsClipPreviews,
    aiClipPreviews,
    manualClipPreviews,
    clipSourceMode,
    activeClipIndex: validActiveClipIndex,
    clipDuration: result.rangeDuration,
    clipStart: snappedStart,
    clipEnd: end,
    faceAnalysisProgress: null,
    analysisEtaSeconds: null,
    rangeWords: words,
  }));

  if (done || metaStage === "rendering") await hydrateExportsFromDisk();
}
