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
import {
  canUseFastPreviewResume,
  runFastPreviewResume,
} from "../../pipeline/fast-resume.util";
import { runPreparePreviewPipeline } from "../../pipeline/range-workflow.util";
import type { ClipperSession } from "../../pipeline/session.util";
import { syncSessionActiveClips } from "../../pipeline/session.util";
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

export interface PreparePreviewFromRangeDeps {
  settings: ClipperSettings;
  metadataRef: React.MutableRefObject<ClipperProjectMetadata>;
  aiClipsMetaRef: React.MutableRefObject<Awaited<ReturnType<typeof fetchClipperClips>>>;
  activeClipIndexRef: React.MutableRefObject<number>;
  reporterRef: React.MutableRefObject<PipelineReporter>;
  persistMetadata: (
    patch: Partial<ClipperProjectMetadata>,
    stage?: ClipperProjectMetadata["stage"],
  ) => void;
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

  const [autoPartsDbClips, aiDbClips, fetchedDisabledRegionIds] = await Promise.all([
    fetchClipperClips(options.projectId, "auto-parts").catch(() => []),
    fetchClipperClips(options.projectId, "ai").catch(() => []),
    fetchDisabledCollageRegions(options.projectId).catch(() => []),
  ]);
  aiClipsMetaRef.current = aiDbClips;
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
    ).catch((error) =>
      clipperError(`pipeline[${runId}]: repair auto-parts clips failed`, error),
    );
  }

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
          generatedClips: clipsForResume.map((clip) => ({
            index: clip.index,
            startSec: clip.startSec,
            endSec: clip.endSec,
          })),
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

  const generatedClips = clipsToPayload(result.clips);
  void saveClipperClips(options.projectId, "auto-parts", generatedClips).catch((error) =>
    clipperError(`pipeline[${runId}]: save auto-parts clips failed`, error),
  );

  const restoredActiveClipIndex =
    metadataRef.current.activeClipIndex ?? activeClipIndexRef.current ?? 0;

  persistMetadata(
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

  const clipSourceMode = metadataRef.current.clipSourceMode ?? "auto-parts";
  const autoPartsClipPreviews = buildClipPreviews(result.clips);
  session.autoPartsClips = result.clips;
  session.aiClips = rebuildClipsFromDbPayload(
    aiDbClips,
    words,
    wordsPerGroup,
    session.rangeEnd - session.rangeStart,
    session.audioEnvelope ?? undefined,
  );
  session.clipSourceMode = clipSourceMode;
  syncSessionActiveClips(session);

  const aiClipPreviews = buildClipPreviews(session.aiClips);
  const clipPreviews = activeClipPreviewsForMode(
    clipSourceMode,
    autoPartsClipPreviews,
    aiClipPreviews,
  );
  const validActiveClipIndex =
    restoredActiveClipIndex < clipPreviews.length ? restoredActiveClipIndex : 0;
  activeClipIndexRef.current = validActiveClipIndex;
  session.activeClipIndex = validActiveClipIndex;

  clipperLog(`pipeline[${runId}]: post-face — enter preview`, {
    rangeDuration: result.rangeDuration,
    clipCount: result.clips.length,
  });

  const metaStage = metadataRef.current.stage;
  setState((prev) => ({
    ...prev,
    stage: metaStage === "done" ? "done" : "preview",
    stageMessage:
      metaStage === "done"
        ? "Your clips are ready!"
        : `Review ${result.clips.length} clip${result.clips.length > 1 ? "s" : ""}, then render`,
    rangeTrimmedVideoUrl: result.rangeTrimmedVideoUrl,
    clipPreviews,
    autoPartsClipPreviews,
    aiClipPreviews,
    clipSourceMode,
    activeClipIndex: validActiveClipIndex,
    clipDuration: result.rangeDuration,
    clipStart: snappedStart,
    clipEnd: end,
    faceAnalysisProgress: null,
    analysisEtaSeconds: null,
    rangeWords: words,
  }));

  if (metaStage === "done" || metaStage === "rendering") {
    await hydrateExportsFromDisk();
  }
}
