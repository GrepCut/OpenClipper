import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Project } from "../../../services/projects.service";
import { isMediabunnyConvertSupported } from '../lib/convert/mediabunny-convert';
import { CLIPPER_FORMAT_DEFS } from "../shared/formats";
import type { ClipperClipPreview, ClipperFormatResult, ClipperPipelineState, ClipSourceMode } from "../shared/state";
import type { ClipperStage } from "../shared/stages";
import { DEFAULT_CLIPPER_SETTINGS, type ClipperSettings } from "../settings/settings";
import {
  flushClipperProjectMetadataSave,
  registerClipperPersistenceFlushListeners,
  scheduleClipperProjectMetadataSave,
  scheduleClipperProjectMetadataSaveImmediate,
} from "../persistence/metadata-autosave";
import {
  scheduleClipperProjectSettingsSave,
  flushClipperProjectSettingsSave,
} from "../persistence/settings-autosave";
import { saveClipperSettings } from "../settings/settings-storage";
import type { ClipperProjectMetadata } from "../persistence/project-metadata";
import {
  fetchClipperExports,
  syncClipperExportsBulk,
} from "../persistence/clipper-db-api";
import {
  fetchClipperClips,
  fetchDisabledCollageRegions,
  saveClipperClips,
  saveDisabledCollageRegions,
  type ClipperClipPayload,
} from "../persistence/clipper-clips-api";
import {
  clipperPipelineService,
  isClipperStepCompleted,
} from "../persistence/pipeline-api";
import { removeClipperProjectDataDir } from "../persistence/project-data-files";
import { releasePlayableMediaUrl } from "../persistence/tauri-media";
import {
  CLIPPER_EXPORT_MANIFEST_VERSION,
  loadClipperExportsFromManifest,
  readClipperExportManifest,
  type ClipperExportManifest,
} from "../persistence/export-files";
import { clipperError, clipperLog } from "../shared/logger";
import { appendUniqueExportResults } from "../shared/export-results";
import type { PipelineReporter } from "../pipeline/reporter";
import { createThrottledReporter } from "../pipeline/throttled-reporter";
import { buildFrameContext, getActiveClips, syncSessionActiveClips, type ClipperSession } from "../pipeline/session";
import {
  autoPartsBoundariesEqual,
  normalizeAutoPartsSegmentLengthSec,
  rebuildClipsFromGeneratedMetadata,
  repairAutoPartsBoundaries,
  resolveActiveClipIndexAfterDelete,
  segmentRangeFromTrimmedFile,
  sortClipsByIndex,
  type AutoPartsSegmentLengthSec,
} from "../engine/clip-segmentation";
import { aiClipPicksToWordRanges, buildClipsFromWordRanges, type AiClipSegmentRange } from "../engine/ai-clip-builder";
import {
  applyClipTranscriptEdit,
  clipPayloadFromWordRanges,
  deriveWordRangesFromClip,
  rebuildClipFromWordRanges,
  type ClipTranscriptEditOp,
} from "../engine/clip-transcript-edit";
import {
  clipperAiClipService,
  type ClipperAiChatMessage,
  type ClipperAiClipPick,
  type ClipperAiClipPickerModel,
} from "../persistence/ai-clip-api";
import { runConfirmRangePipeline, runPreparePreviewPipeline } from "../pipeline/range-workflow";
import {
  canUseFastPreviewResume,
  runFastPreviewResume,
} from "../pipeline/fast-resume";
import { runIngestStage } from "../pipeline/stages/ingest";
import { runRenderClipJob, runRerenderFormat, getClipperFormatDef } from "../pipeline/stages/render";
import type { ClipperLoadedProject } from "./useClipperProjectLoader";
import { useClipperResume } from "./useClipperResume";
import {
  deriveInitialPipelineState,
  EMPTY_CLIPPER_PIPELINE_STATE,
} from "../pipeline/resume";

const CLIP_EDIT_HISTORY_MAX = 30;

const METADATA_IMMEDIATE_FLUSH_STAGES: ClipperStage[] = ["preview", "done", "error"];

interface ClipEditSnapshot {
  mode: ClipSourceMode;
  autoPartsClips: import("../engine/clip-segmentation").ClipperGeneratedClip[];
  aiClips: import("../engine/clip-segmentation").ClipperGeneratedClip[];
  aiMeta: ClipperClipPayload[];
  lastEditedRange: { clipIndex: number; startIdx: number; endIdx: number } | null;
}

const INITIAL_STATE = EMPTY_CLIPPER_PIPELINE_STATE;

interface UseClipperPipelineOptions {
  project: Project;
  token: string | null;
  loaded: ClipperLoadedProject | null;
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function applyFilenameTemplate(
  template: string,
  name: string,
  formatId: string,
  clipIndex: number,
): string {
  const clipNum = String(clipIndex + 1).padStart(2, "0");
  return (
    template
      .replace("{name}", name)
      .replace("{platform}", formatId)
      .replace("{clip}", clipNum) || `${name}-clip-${clipNum}-${formatId}`
  );
}

function buildClipPreviews(
  clips: import("../engine/clip-segmentation").ClipperGeneratedClip[],
): ClipperClipPreview[] {
  return sortClipsByIndex(clips).map((clip) => ({
    clip,
    renderStatus: "idle" as const,
    renderProgress: null,
    results: [],
  }));
}

function clipsToPayload(
  clips: import("../engine/clip-segmentation").ClipperGeneratedClip[],
  rangeWords?: import("../../lib/media/transcription-export").WordCue[],
  rangeDurationSec = Infinity,
  envelope?: import("../engine/audio-envelope").RmsEnvelope,
): ClipperClipPayload[] {
  return clips.map((clip) => {
    if (rangeWords?.length) {
      const ranges = deriveWordRangesFromClip(clip, rangeWords);
      const withIndices = clipPayloadFromWordRanges(clip.index, ranges, rangeWords, undefined, rangeDurationSec, undefined, envelope);
      if (withIndices) return withIndices;
    }
    return {
      index: clip.index,
      startSec: clip.startSec,
      endSec: clip.endSec,
      segments: clip.segments.map((seg, orderIndex) => ({
        orderIndex,
        startSec: seg.startSec,
        endSec: seg.endSec,
      })),
    };
  });
}

/** Auto-parts delete must match what the clip list shows (state previews can outlive session). */
function resolveAutoPartsClips(
  session: ClipperSession,
  prev: ClipperPipelineState,
): import("../engine/clip-segmentation").ClipperGeneratedClip[] {
  if (session.autoPartsClips.length > 0) return session.autoPartsClips;

  const fromPreviews = (
    prev.autoPartsClipPreviews.length > 0
      ? prev.autoPartsClipPreviews
      : prev.clipSourceMode !== "ai"
        ? prev.clipPreviews
        : []
  ).map((preview) => preview.clip);
  if (fromPreviews.length > 0) return fromPreviews;

  return session.clipSourceMode !== "ai" ? getActiveClips(session) : [];
}

/** Word-index segments for one persisted clip, when every segment has them (falls back to time-only rebuild otherwise). */
function payloadClipToWordSegments(
  clip: ClipperClipPayload,
): Array<{ wordStartIdx: number; wordEndIdx: number }> {
  if (!clip.segments.length) return [];
  const hasAll = clip.segments.every((s) => s.wordStartIdx != null && s.wordEndIdx != null);
  if (!hasAll) return [];
  return clip.segments.map((s) => ({ wordStartIdx: s.wordStartIdx!, wordEndIdx: s.wordEndIdx! }));
}

/** Rebuilds full clip objects from DB-persisted boundaries (auto-parts: always time-only; AI: word-index when available). */
function rebuildClipsFromDbPayload(
  dbClips: ClipperClipPayload[],
  rangeWords: import("../../lib/media/transcription-export").WordCue[],
  wordsPerGroup: number,
  rangeDurationSec = Infinity,
  envelope?: import("../engine/audio-envelope").RmsEnvelope,
): import("../engine/clip-segmentation").ClipperGeneratedClip[] {
  if (!dbClips.length || !rangeWords.length) return [];

  const hasWordIndices = dbClips.every((clip) => payloadClipToWordSegments(clip).length > 0);

  if (hasWordIndices) {
    return buildClipsFromWordRanges(
      rangeWords,
      dbClips.map((clip) => ({
        segments: payloadClipToWordSegments(clip),
        label: clip.label,
        index: clip.index,
      })),
      wordsPerGroup,
      rangeDurationSec,
      undefined,
      envelope,
    );
  }

  return rebuildClipsFromGeneratedMetadata(
    dbClips.map((clip) => ({
      index: clip.index,
      startSec: clip.startSec,
      endSec: clip.endSec,
    })),
    rangeWords,
    wordsPerGroup,
  );
}

function activeClipPreviewsForMode(
  mode: ClipSourceMode,
  autoPartsClipPreviews: ClipperClipPreview[],
  aiClipPreviews: ClipperClipPreview[],
): ClipperClipPreview[] {
  return mode === "ai" ? aiClipPreviews : autoPartsClipPreviews;
}

function manifestFromDbExports(
  exports: Awaited<ReturnType<typeof fetchClipperExports>>,
): ClipperExportManifest {
  return {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports: exports.map((record) => ({
      id: record.id,
      clipIndex: record.clipIndex,
      formatId: record.formatId,
      fileName: record.fileName,
      relativePath: record.relativePath,
      width: record.width,
      height: record.height,
      fileSize: record.fileSize,
      exportedAt: record.createdAt,
    })),
  };
}

function mergeExportManifests(
  diskManifest: ClipperExportManifest | null,
  dbManifest: ClipperExportManifest | null,
): ClipperExportManifest | null {
  const byId = new Map<string, ClipperExportManifest["exports"][number]>();
  for (const entry of diskManifest?.exports ?? []) {
    byId.set(entry.id, entry);
  }
  for (const entry of dbManifest?.exports ?? []) {
    byId.set(entry.id, entry);
  }
  if (byId.size === 0) return null;
  return {
    version: CLIPPER_EXPORT_MANIFEST_VERSION,
    exports: [...byId.values()].sort(
      (a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime(),
    ),
  };
}

async function resolveClipperExportManifest(projectId: string): Promise<ClipperExportManifest | null> {
  const [diskManifest, dbExports] = await Promise.all([
    readClipperExportManifest(projectId),
    fetchClipperExports(projectId).catch(() => [] as Awaited<ReturnType<typeof fetchClipperExports>>),
  ]);

  const dbManifest = dbExports.length > 0 ? manifestFromDbExports(dbExports) : null;
  const merged = mergeExportManifests(diskManifest, dbManifest);

  if (dbExports.length === 0 && diskManifest?.exports.length) {
    void syncClipperExportsBulk(projectId, diskManifest.exports).catch((error) => {
      clipperError("pipeline: export DB backfill failed", error);
    });
    return diskManifest;
  }

  return merged;
}

function describeClipperError(error: unknown): string {
  let message =
    error instanceof Error ? error.message : "Something went wrong while creating your clip.";
  if (/file too large|FST_REQ_FILE_TOO_LARGE/i.test(message)) {
    message =
      "The audio upload was too large for the server. The clip is sent as compressed MP3 — if this persists, contact support.";
  }
  return message;
}

function createReporter(
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>,
): PipelineReporter {
  return {
    stage: (stage, message) =>
      setState((prev) => ({
        ...prev,
        stage,
        ...(message !== undefined ? { stageMessage: message } : {}),
      })),
    stageProgress: (ratio) => setState((prev) => ({ ...prev, stageProgress: ratio })),
    faceProgress: (ratio) => setState((prev) => ({ ...prev, faceAnalysisProgress: ratio })),
    subjectProgress: (ratio) => setState((prev) => ({ ...prev, subjectAnalysisProgress: ratio })),
    eta: (seconds) => setState((prev) => ({ ...prev, analysisEtaSeconds: seconds })),
    faces: (hasDetectedFaces, hasTwoSpeakers, sampleRevision) =>
      setState((prev) =>
        prev.hasDetectedFaces === hasDetectedFaces &&
        prev.hasTwoSpeakers === hasTwoSpeakers &&
        prev.faceSampleRevision === sampleRevision
          ? prev
          : { ...prev, hasDetectedFaces, hasTwoSpeakers, faceSampleRevision: sampleRevision },
      ),
    renderProgress: (key, ratio) =>
      setState((prev) => ({
        ...prev,
        renderProgress: { ...prev.renderProgress, [key]: ratio },
      })),
  };
}

export function useClipperPipeline({ project, token, loaded }: UseClipperPipelineOptions) {
  const [state, setState] = useState<ClipperPipelineState>(() =>
    deriveInitialPipelineState(loaded, project.id),
  );
  const [settings, setSettingsState] = useState<ClipperSettings>(
    () => loaded?.settings ?? DEFAULT_CLIPPER_SETTINGS,
  );
  const [persistedExportCount, setPersistedExportCount] = useState(0);
  const [aiChatMessages, setAiChatMessages] = useState<ClipperAiChatMessage[]>([]);
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatError, setAiChatError] = useState<string | null>(null);
  const [aiChatThinking, setAiChatThinking] = useState("");
  const [aiChatProgressChars, setAiChatProgressChars] = useState(0);
  const [aiChatModel, setAiChatModel] = useState<ClipperAiClipPickerModel>("deepseek-v4-flash");
  const [rangeLocked, setRangeLocked] = useState(
    () => (loaded ? isClipperStepCompleted(loaded.steps, "confirm_range") : false),
  );
  const [disabledCollageRegionIds, setDisabledCollageRegionIds] = useState<string[]>([]);
  const [autoPartsSegmentLengthSec, setAutoPartsSegmentLengthSec] = useState<AutoPartsSegmentLengthSec>(
    () => normalizeAutoPartsSegmentLengthSec(loaded?.metadata.autoPartsSegmentLengthSec),
  );
  const [autoPartsResegmenting, setAutoPartsResegmenting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const sessionRef = useRef<ClipperSession | null>(null);
  const activeClipIndexRef = useRef(0);
  const metadataRef = useRef<ClipperProjectMetadata>(
    loaded?.metadata ?? {
      version: 1,
      stage: "idle",
      sourceMediaFileId: null,
      clipStart: 0,
      clipEnd: null,
    },
  );
  const resumeStartedRef = useRef(false);
  const loadedResumeKeyRef = useRef<string | null>(null);
  /** Mirrors the currently-persisted AI clip rows (with word indices/label) — source for delete/re-index and the AI chat's "current clips" context, since that data no longer lives in `metadataRef`. */
  const aiClipsMetaRef = useRef<ClipperClipPayload[]>([]);
  const clipEditUndoStackRef = useRef<ClipEditSnapshot[]>([]);
  const clipEditRedoStackRef = useRef<ClipEditSnapshot[]>([]);
  const transcriptClipboardRef = useRef<AiClipSegmentRange[]>([]);
  const lastEditedTranscriptRangeRef = useRef<{
    clipIndex: number;
    startIdx: number;
    endIdx: number;
  } | null>(null);
  const [lastEditedTranscriptRange, setLastEditedTranscriptRange] = useState<{
    clipIndex: number;
    startIdx: number;
    endIdx: number;
  } | null>(null);
  const [canUndoClipEdit, setCanUndoClipEdit] = useState(false);
  const [canRedoClipEdit, setCanRedoClipEdit] = useState(false);

  const reporterRef = useRef<PipelineReporter>(createThrottledReporter(createReporter(setState)));

  const hydrateExportsFromDisk = useCallback(async (): Promise<ClipperFormatResult[]> => {
    const manifest = await resolveClipperExportManifest(project.id);
    if (!manifest?.exports.length) return [];

    const restored = await loadClipperExportsFromManifest(project.id, manifest);
    if (!restored.length) return [];

    for (const r of restored) {
      if (r.previewUrl.startsWith("blob:")) {
        previewUrlsRef.current.push(r.previewUrl);
      }
    }

    const metadataStage = metadataRef.current.stage;
    setState((prev) => ({
      ...prev,
      exportHistory: restored,
      ...(metadataStage === "rendering"
        ? { stage: "preview" as const }
        : metadataStage === "done"
          ? { stage: "done" as const }
          : {}),
    }));

    setPersistedExportCount(restored.length);
    return restored;
  }, [project.id]);

  const persistMetadata = useCallback(
    (patch: Partial<ClipperProjectMetadata>, stage?: ClipperStage) => {
      metadataRef.current = {
        ...metadataRef.current,
        ...patch,
        stage: stage ?? patch.stage ?? metadataRef.current.stage,
      };
      const nextStage = metadataRef.current.stage;
      if (METADATA_IMMEDIATE_FLUSH_STAGES.includes(nextStage)) {
        scheduleClipperProjectMetadataSaveImmediate(project.id, metadataRef.current);
      } else {
        scheduleClipperProjectMetadataSave(project.id, metadataRef.current);
      }
    },
    [project.id],
  );

  const revokePreviewUrls = useCallback(() => {
    for (const url of previewUrlsRef.current) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    previewUrlsRef.current = [];
  }, []);

  const clearSession = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      releasePlayableMediaUrl(session.sourceUrl);
      if (session.rangeTrimmedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(session.rangeTrimmedVideoUrl);
      } else if (session.trimmedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(session.trimmedVideoUrl);
      }
      sessionRef.current = null;
    }
  }, []);

  const updateSettings = useCallback(
    (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => {
      setSettingsState((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (p: ClipperSettings) => ClipperSettings)(prev)
            : updater;
        scheduleClipperProjectSettingsSave(project.id, next);
        saveClipperSettings(next);
        return next;
      });
    },
    [project.id],
  );

  const resetSettings = useCallback(() => updateSettings(DEFAULT_CLIPPER_SETTINGS), [updateSettings]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    revokePreviewUrls();
    clearSession();
    resumeStartedRef.current = false;
    activeClipIndexRef.current = 0;
    setState(INITIAL_STATE);
    persistMetadata(
      {
        stage: "idle",
        sourceMediaFileId: null,
        clipStart: 0,
        clipEnd: null,
        transcribedClipStart: undefined,
        transcribedClipEnd: undefined,
        activeClipIndex: undefined,
      },
      "idle",
    );
  }, [clearSession, persistMetadata, revokePreviewUrls]);

  const setActiveClipIndex = useCallback((index: number) => {
    activeClipIndexRef.current = index;
    const session = sessionRef.current;
    if (session) session.activeClipIndex = index;
    setState((prev) => ({ ...prev, activeClipIndex: index }));
    persistMetadata({ activeClipIndex: index });
  }, [persistMetadata]);

  const preparePreviewFromRange = useCallback(
    async (
      session: ClipperSession,
      snappedStart: number,
      end: number,
      words: import("../../lib/media/transcription-export").WordCue[],
      controller: AbortController,
      runId: string,
      options: {
        skipFaceDetect?: boolean;
        skipSubjectAnalysis?: boolean;
        skipTrim?: boolean;
        projectId: string;
        mediaFileId: string;
      },
    ) => {
      const wordsPerGroup = settings.captions.wordsPerGroup;
      const metadata = metadataRef.current;
      const captionWordsPerGroup = metadata.wordsPerGroupAtTranscribe ?? wordsPerGroup;
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
        wordsPerGroup: captionWordsPerGroup,
        targetLengthSec: segmentLength,
        enabledFormatIds: settings.formats.enabledFormatIds,
        smoothing: settings.reframe.smoothing,
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

      persistMetadata(
        {
          clipStart: snappedStart,
          clipEnd: end,
          transcribedClipStart: snappedStart,
          transcribedClipEnd: end,
          wordsPerGroupAtTranscribe: wordsPerGroup,
          autoPartsSegmentLengthSec: segmentLength,
          activeClipIndex: 0,
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
        captionWordsPerGroup,
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
      activeClipIndexRef.current = 0;

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
        activeClipIndex: 0,
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
    },
    [hydrateExportsFromDisk, persistMetadata, settings.captions.wordsPerGroup],
  );

  const confirmRange = useCallback(
    async (start: number, end: number) => {
      const session = sessionRef.current;
      if (!session) return;

      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      revokePreviewUrls();
      if (session.rangeTrimmedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(session.rangeTrimmedVideoUrl);
      }
      session.rangeTrimmedFile = null;
      session.rangeTrimmedVideoUrl = null;
      session.trimmedFile = null;
      session.trimmedVideoUrl = null;
      session.autoPartsClips = [];
      session.aiClips = [];
      syncSessionActiveClips(session);

      setState((prev) => ({
        ...prev,
        stage: "uploading",
        stageMessage: "Preparing your clips…",
        renderProgress: {},
        exportHistory: prev.exportHistory,
        rangeTrimmedVideoUrl: null,
        clipPreviews: [],
        autoPartsClipPreviews: [],
        aiClipPreviews: [],
        activeClipIndex: 0,
        error: null,
        clipStart: start,
        clipEnd: end,
        hasDetectedFaces: null,
        hasTwoSpeakers: null,
        faceAnalysisProgress: null,
        analysisEtaSeconds: null,
        stageProgress: 0,
      }));

      try {
        const { snappedStart, end: rangeEnd, words } = await runConfirmRangePipeline(
          session,
          {
            projectId: project.id,
            start,
            end,
            wordsPerGroup: settings.captions.wordsPerGroup,
            metadata: metadataRef.current,
            engine: settings.transcription.engine,
          },
          reporterRef.current,
          { signal: controller.signal },
        );
        setRangeLocked(true);

        persistMetadata(
          {
            clipStart: snappedStart,
            clipEnd: rangeEnd,
            transcribedClipStart: snappedStart,
            transcribedClipEnd: rangeEnd,
            wordsPerGroupAtTranscribe: settings.captions.wordsPerGroup,
            transcriptionEngine: settings.transcription.engine,
          },
          "analyzing-faces",
        );

        await preparePreviewFromRange(session, snappedStart, rangeEnd, words, controller, runId, {
          projectId: project.id,
          mediaFileId: session.mediaFileId,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        clipperError(`pipeline[${runId}]: failed`, error);
        persistMetadata({}, "error");
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: describeClipperError(error),
          rangeTrimmedVideoUrl: null,
          clipPreviews: [],
          autoPartsClipPreviews: [],
          aiClipPreviews: [],
        }));
      }
    },
    [persistMetadata, preparePreviewFromRange, project.id, revokePreviewUrls, settings.captions.wordsPerGroup, token],
  );

  const selectFile = useCallback(
    async (file: File) => {
      if (!isMediabunnyConvertSupported()) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error:
            "Your browser does not support in-browser video encoding. Try the latest Chrome, Edge, or Opera.",
        }));
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      revokePreviewUrls();
      clearSession();

      try {
        const { session, mediaFileId, duration } = await runIngestStage(
          project,
          file,
          token ?? "",
          reporterRef.current,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;

        sessionRef.current = session;
        persistMetadata(
          {
            sourceMediaFileId: mediaFileId,
            clipStart: 0,
            clipEnd: null,
            transcribedClipStart: undefined,
            transcribedClipEnd: undefined,
            activeClipIndex: undefined,
          },
          "trimming",
        );

        setState((prev) => ({
          ...prev,
          stage: "trimming",
          stageMessage: "Choose your source range",
          sourceDuration: duration,
          sourceFileName: file.name,
          stageProgress: null,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        clipperError("pipeline: upload failed", error);
        clearSession();
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: error instanceof Error ? error.message : "Could not save this video to your project.",
        }));
      }
    },
    [clearSession, persistMetadata, project, revokePreviewUrls, token],
  );

  const clipAgain = useCallback(() => {
    if (!sessionRef.current) return;
    revokePreviewUrls();
    void clipperPipelineService.resetPipeline(project.id);
    void removeClipperProjectDataDir(project.id);
    setRangeLocked(false);
    resumeStartedRef.current = false;
    activeClipIndexRef.current = 0;
    persistMetadata(
      {
        clipEnd: null,
        transcribedClipStart: undefined,
        transcribedClipEnd: undefined,
        activeClipIndex: undefined,
      },
      "trimming",
    );
    setState((prev) => ({
      ...prev,
      stage: "trimming",
      stageMessage: "Choose your source range",
      exportHistory: [],
      rangeTrimmedVideoUrl: null,
      clipPreviews: [],
      autoPartsClipPreviews: [],
      aiClipPreviews: [],
      activeClipIndex: 0,
      error: null,
      renderProgress: {},
    }));
  }, [persistMetadata, project.id, revokePreviewUrls]);

  const setClipSourceMode = useCallback(
    (mode: ClipSourceMode) => {
      const session = sessionRef.current;
      if (session) {
        session.clipSourceMode = mode;
        syncSessionActiveClips(session);
      }
      persistMetadata({ clipSourceMode: mode });
      setState((prev) => ({
        ...prev,
        clipSourceMode: mode,
        clipPreviews: activeClipPreviewsForMode(
          mode,
          prev.autoPartsClipPreviews ?? [],
          prev.aiClipPreviews ?? [],
        ),
        activeClipIndex: Math.min(
          prev.activeClipIndex,
          Math.max(
            0,
            activeClipPreviewsForMode(
              mode,
              prev.autoPartsClipPreviews ?? [],
              prev.aiClipPreviews ?? [],
            ).length - 1,
          ),
        ),
      }));
    },
    [persistMetadata],
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
      const trimmedFile = session?.rangeTrimmedFile ?? session?.trimmedFile;
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
          metadataRef.current.wordsPerGroupAtTranscribe ?? settings.captions.wordsPerGroup;

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
        await saveClipperClips(project.id, "auto-parts", payload);
        persistMetadata({ autoPartsSegmentLengthSec: segmentLengthSec });
        setAutoPartsSegmentLengthSec(segmentLengthSec);

        const autoPartsClipPreviews = buildClipPreviews(clips);
        setState((prev) => ({
          ...prev,
          autoPartsClipPreviews,
          clipPreviews:
            prev.clipSourceMode === "ai" ? prev.clipPreviews : autoPartsClipPreviews,
          activeClipIndex: Math.min(
            prev.activeClipIndex,
            Math.max(0, clips.length - 1),
          ),
          stageMessage: `Review ${clips.length} clip${clips.length > 1 ? "s" : ""}, then render`,
        }));
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
      autoPartsResegmenting,
      autoPartsSegmentLengthSec,
      persistMetadata,
      project.id,
      settings.captions.wordsPerGroup,
    ],
  );

  const loadAiChatHistory = useCallback(async () => {
    try {
      const messages = await clipperAiClipService.getChatHistory(project.id);
      setAiChatMessages(messages);
      setAiChatError(null);
    } catch (error) {
      clipperError("pipeline: AI chat history load failed", error);
      setAiChatError(
        error instanceof Error ? error.message : "Could not load AI chat history.",
      );
    }
  }, [project.id]);

  const startNewAiChat = useCallback(async () => {
    try {
      await clipperAiClipService.clearChatHistory(project.id);
      setAiChatMessages([]);
      setAiChatError(null);
    } catch (error) {
      clipperError("pipeline: AI chat clear failed", error);
      setAiChatError(
        error instanceof Error ? error.message : "Could not start a new chat.",
      );
    }
  }, [project.id]);

  const aiChatAbortRef = useRef<AbortController | null>(null);

  const applyAiClipsAndPersist = useCallback(
    (
      aiClips: ReturnType<typeof buildClipsFromWordRanges>,
      aiGeneratedClips: ClipperClipPayload[],
    ) => {
      const session = sessionRef.current;
      if (!session) return;

      session.aiClips = sortClipsByIndex(aiClips);
      if (session.clipSourceMode === "ai") {
        syncSessionActiveClips(session);
      }

      const sortedMeta = [...aiGeneratedClips].sort((a, b) => a.index - b.index);
      aiClipsMetaRef.current = sortedMeta;
      void saveClipperClips(project.id, "ai", sortedMeta).catch((error) =>
        clipperError("pipeline: save AI clips failed", error),
      );

      const aiClipPreviews = buildClipPreviews(session.aiClips);
      setState((prev) => {
        const sorted = session.aiClips;
        const nextActive =
          prev.clipSourceMode === "ai"
            ? sorted.some((clip) => clip.index === prev.activeClipIndex)
              ? prev.activeClipIndex
              : sorted[0]?.index ?? 0
            : prev.activeClipIndex;
        if (prev.clipSourceMode === "ai") {
          activeClipIndexRef.current = nextActive;
          if (session) session.activeClipIndex = nextActive;
        }
        return {
          ...prev,
          aiClipPreviews,
          clipPreviews:
            prev.clipSourceMode === "ai" ? aiClipPreviews : prev.clipPreviews,
          activeClipIndex: nextActive,
        };
      });
    },
    [project.id],
  );

  const applyAiClipResult = useCallback(
    (clips: ClipperAiClipPick[]) => {
      const session = sessionRef.current;
      if (!session) return;

      const aiClips = buildClipsFromWordRanges(
        session.rangeWords,
        aiClipPicksToWordRanges(clips),
        settings.captions.wordsPerGroup,
        session.rangeEnd - session.rangeStart,
        undefined,
        session.audioEnvelope ?? undefined,
      );

      const aiGeneratedClips: ClipperClipPayload[] = aiClips.map((builtClip) => {
        const pick = clips.find((clip) => clip.index === builtClip.index)!;
        return {
          index: builtClip.index,
          startSec: builtClip.startSec,
          endSec: builtClip.endSec,
          label: pick.label,
          segments: builtClip.segments.map((segment, orderIndex) => ({
            orderIndex,
            ...segment,
            wordStartIdx: pick.segments[orderIndex]!.wordStartIdx,
            wordEndIdx: pick.segments[orderIndex]!.wordEndIdx,
          })),
        };
      });

      applyAiClipsAndPersist(aiClips, aiGeneratedClips);
    },
    [applyAiClipsAndPersist, settings.captions.wordsPerGroup],
  );

  const deleteAiClip = useCallback(
    (index: number) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const previousActive = activeClipIndexRef.current;
      const remainingMeta = [...aiClipsMetaRef.current]
        .filter((clip) => clip.index !== index)
        .sort((a, b) => a.index - b.index);

      const aiClips = sortClipsByIndex(
        buildClipsFromWordRanges(
          session.rangeWords,
          remainingMeta.map((clip) => ({
            segments: payloadClipToWordSegments(clip),
            label: clip.label,
            index: clip.index,
          })),
          settings.captions.wordsPerGroup,
          session.rangeEnd - session.rangeStart,
          undefined,
          session.audioEnvelope ?? undefined,
        ),
      );

      applyAiClipsAndPersist(aiClips, remainingMeta);

      const nextActive = resolveActiveClipIndexAfterDelete(previousActive, index, aiClips);
      activeClipIndexRef.current = nextActive;
      session.activeClipIndex = nextActive;
      setState((prev) => ({ ...prev, activeClipIndex: nextActive }));
      persistMetadata({ activeClipIndex: nextActive });
    },
    [applyAiClipsAndPersist, persistMetadata, settings.captions.wordsPerGroup],
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

        void saveClipperClips(project.id, "auto-parts", clipsToPayload(remaining)).catch((error) =>
          clipperError("pipeline: save auto-parts clips after delete failed", error),
        );

        const nextActive = resolveActiveClipIndexAfterDelete(previousActive, index, remaining);
        activeClipIndexRef.current = nextActive;
        session.activeClipIndex = nextActive;
        void persistMetadata({ activeClipIndex: nextActive });

        const autoPartsClipPreviews = buildClipPreviews(remaining);
        return {
          ...prev,
          autoPartsClipPreviews,
          clipPreviews:
            prev.clipSourceMode !== "ai" ? autoPartsClipPreviews : prev.clipPreviews,
          activeClipIndex: nextActive,
        };
      });
    },
    [persistMetadata, project.id],
  );

  const captureClipEditSnapshot = useCallback((): ClipEditSnapshot | null => {
    const session = sessionRef.current;
    if (!session) return null;
    return {
      mode: session.clipSourceMode ?? "auto-parts",
      autoPartsClips: session.autoPartsClips.map((clip) => ({ ...clip })),
      aiClips: session.aiClips.map((clip) => ({ ...clip })),
      aiMeta: [...aiClipsMetaRef.current],
      lastEditedRange: lastEditedTranscriptRangeRef.current,
    };
  }, []);

  const restoreClipEditSnapshot = useCallback(
    (snapshot: ClipEditSnapshot) => {
      const session = sessionRef.current;
      if (!session) return;

      session.autoPartsClips = snapshot.autoPartsClips;
      session.aiClips = snapshot.aiClips;
      aiClipsMetaRef.current = snapshot.aiMeta;
      syncSessionActiveClips(session);
      session.captionGroupsCache = null;
      lastEditedTranscriptRangeRef.current = snapshot.lastEditedRange;
      setLastEditedTranscriptRange(snapshot.lastEditedRange);

      void saveClipperClips(
        project.id,
        "auto-parts",
        clipsToPayload(snapshot.autoPartsClips, session.rangeWords),
      ).catch((error) =>
        clipperError("pipeline: save auto-parts clips after transcript undo failed", error),
      );
      void saveClipperClips(project.id, "ai", snapshot.aiMeta).catch((error) =>
        clipperError("pipeline: save AI clips after transcript undo failed", error),
      );

      const autoPartsClipPreviews = buildClipPreviews(snapshot.autoPartsClips);
      const aiClipPreviews = buildClipPreviews(snapshot.aiClips);
      setState((prev) => ({
        ...prev,
        autoPartsClipPreviews,
        aiClipPreviews,
        clipPreviews: activeClipPreviewsForMode(
          prev.clipSourceMode ?? "auto-parts",
          autoPartsClipPreviews,
          aiClipPreviews,
        ),
      }));
    },
    [project.id],
  );

  const pushClipEditSnapshot = useCallback(() => {
    const snapshot = captureClipEditSnapshot();
    if (!snapshot) return;
    clipEditUndoStackRef.current.push(snapshot);
    if (clipEditUndoStackRef.current.length > CLIP_EDIT_HISTORY_MAX) {
      clipEditUndoStackRef.current.shift();
    }
    clipEditRedoStackRef.current = [];
    setCanUndoClipEdit(true);
    setCanRedoClipEdit(false);
  }, [captureClipEditSnapshot]);

  const editClipTranscript = useCallback(
    (clipIndex: number, op: ClipTranscriptEditOp) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const isAi = (session.clipSourceMode ?? "auto-parts") === "ai";
      const clips = isAi
        ? session.aiClips
        : session.autoPartsClips.length > 0
          ? session.autoPartsClips
          : getActiveClips(session);
      const clip = clips.find((c) => c.index === clipIndex);
      if (!clip) return;

      if (op.type === "copy") {
        const ranges = deriveWordRangesFromClip(clip, session.rangeWords);
        const result = applyClipTranscriptEdit(ranges, op);
        if (result.clipboard?.length) transcriptClipboardRef.current = result.clipboard;
        if (result.editedRange) {
          const edited = { clipIndex, ...result.editedRange };
          lastEditedTranscriptRangeRef.current = edited;
          setLastEditedTranscriptRange(edited);
        }
        return;
      }

      pushClipEditSnapshot();

      const ranges = deriveWordRangesFromClip(clip, session.rangeWords);
      const resolvedOp: ClipTranscriptEditOp =
        op.type === "paste"
          ? { ...op, clipboard: op.clipboard ?? transcriptClipboardRef.current }
          : op;
      const result = applyClipTranscriptEdit(ranges, resolvedOp);

      if (result.clipboard?.length) transcriptClipboardRef.current = result.clipboard;

      if (result.isEmpty) {
        clipEditUndoStackRef.current.pop();
        setCanUndoClipEdit(clipEditUndoStackRef.current.length > 0);
        if (isAi) deleteAiClip(clipIndex);
        else deleteAutoPartsClip(clipIndex);
        lastEditedTranscriptRangeRef.current = null;
        setLastEditedTranscriptRange(null);
        return;
      }

      const label = isAi
        ? aiClipsMetaRef.current.find((c) => c.index === clipIndex)?.label
        : undefined;
      const rebuilt = rebuildClipFromWordRanges(
        clipIndex,
        result.ranges,
        session.rangeWords,
        settings.captions.wordsPerGroup,
        label,
        session.rangeEnd - session.rangeStart,
        undefined,
        session.audioEnvelope ?? undefined,
      );
      const payload = clipPayloadFromWordRanges(
        clipIndex,
        result.ranges,
        session.rangeWords,
        label,
        session.rangeEnd - session.rangeStart,
        undefined,
        session.audioEnvelope ?? undefined,
      );
      if (!rebuilt || !payload) return;

      if (isAi) {
        const nextClips = sortClipsByIndex(
          session.aiClips.map((c) => (c.index === clipIndex ? rebuilt : c)),
        );
        const nextMeta = aiClipsMetaRef.current.map((c) =>
          c.index === clipIndex ? payload : c,
        );
        applyAiClipsAndPersist(nextClips, nextMeta);
      } else {
        const nextClips = sortClipsByIndex(
          clips.map((c) => (c.index === clipIndex ? rebuilt : c)),
        );
        session.autoPartsClips = nextClips;
        syncSessionActiveClips(session);
        session.captionGroupsCache = null;
        void saveClipperClips(
          project.id,
          "auto-parts",
          clipsToPayload(
            nextClips,
            session.rangeWords,
            session.rangeEnd - session.rangeStart,
            session.audioEnvelope ?? undefined,
          ),
        ).catch((error) =>
          clipperError("pipeline: save auto-parts clips after edit failed", error),
        );
        const autoPartsClipPreviews = buildClipPreviews(nextClips);
        setState((prev) => ({
          ...prev,
          autoPartsClipPreviews,
          clipPreviews:
            prev.clipSourceMode !== "ai" ? autoPartsClipPreviews : prev.clipPreviews,
        }));
      }

      if (result.editedRange) {
        const edited = { clipIndex, ...result.editedRange };
        lastEditedTranscriptRangeRef.current = edited;
        setLastEditedTranscriptRange(edited);
      }
    },
    [
      applyAiClipsAndPersist,
      deleteAiClip,
      deleteAutoPartsClip,
      project.id,
      pushClipEditSnapshot,
      settings.captions.wordsPerGroup,
    ],
  );

  const undoClipEdit = useCallback(() => {
    const snapshot = clipEditUndoStackRef.current.pop();
    if (!snapshot) return;
    const current = captureClipEditSnapshot();
    if (current) clipEditRedoStackRef.current.push(current);
    restoreClipEditSnapshot(snapshot);
    setCanUndoClipEdit(clipEditUndoStackRef.current.length > 0);
    setCanRedoClipEdit(true);
  }, [captureClipEditSnapshot, restoreClipEditSnapshot]);

  const redoClipEdit = useCallback(() => {
    const snapshot = clipEditRedoStackRef.current.pop();
    if (!snapshot) return;
    const current = captureClipEditSnapshot();
    if (current) clipEditUndoStackRef.current.push(current);
    restoreClipEditSnapshot(snapshot);
    setCanUndoClipEdit(true);
    setCanRedoClipEdit(clipEditRedoStackRef.current.length > 0);
  }, [captureClipEditSnapshot, restoreClipEditSnapshot]);

  const toggleCollageRegion = useCallback(
    (regionId: string) => {
      setDisabledCollageRegionIds((prev) => {
        const next = prev.includes(regionId)
          ? prev.filter((id) => id !== regionId)
          : [...prev, regionId];
        const session = sessionRef.current;
        if (session) session.disabledCollageRegionIds = next;
        void saveDisabledCollageRegions(project.id, next).catch((error) =>
          clipperError("pipeline: save collage region overrides failed", error),
        );
        return next;
      });
    },
    [project.id],
  );

  const sendAiClipChatMessage = useCallback(
    async (message: string, options?: { preset?: string }) => {
      const session = sessionRef.current;
      if (!session?.rangeWords.length) return;

      const trimmed = message.trim();
      if (!trimmed) return;

      aiChatAbortRef.current?.abort();
      const abortController = new AbortController();
      aiChatAbortRef.current = abortController;

      setAiChatLoading(true);
      setAiChatError(null);
      setAiChatThinking("");
      setAiChatProgressChars(0);

      try {
        const currentClips = aiClipsMetaRef.current
          .map((clip) => ({
            segments: payloadClipToWordSegments(clip),
            label: clip.label,
          }))
          .filter((clip) => clip.segments.length > 0);

        let streamError: string | null = null;

        await clipperAiClipService.sendChatMessageStream(
          project.id,
          {
            message: trimmed,
            model: aiChatModel,
            preset: options?.preset,
            words: session.rangeWords,
            currentClips: currentClips?.length ? currentClips : undefined,
          },
          {
            onUserMessage: (userMessage) => {
              setAiChatMessages((prev) => [...prev, userMessage]);
            },
            onThinkingDelta: (delta) => {
              setAiChatThinking((prev) => prev + delta);
            },
            onProgress: (chars) => {
              setAiChatProgressChars(chars);
            },
            onDone: (result) => {
              setAiChatMessages((prev) => [...prev, result.assistantMessage]);
              applyAiClipResult(result.clips);
            },
            onError: (message) => {
              streamError = message;
            },
          },
          abortController.signal,
        );

        if (streamError) {
          setAiChatError(streamError);
        }
      } catch (error) {
        if (abortController.signal.aborted) return;
        clipperError("pipeline: AI clip chat failed", error);
        setAiChatError(
          error instanceof Error ? error.message : "AI clip picking failed.",
        );
      } finally {
        if (aiChatAbortRef.current === abortController) {
          aiChatAbortRef.current = null;
        }
        setAiChatLoading(false);
        setAiChatThinking("");
        setAiChatProgressChars(0);
      }
    },
    [aiChatModel, applyAiClipResult, project.id],
  );

  const renderExports = useCallback(async (perClipFormatIds?: Record<number, string[]>) => {
    const session = sessionRef.current;
    if (!session?.rangeTrimmedFile && !session?.trimmedFile) return;

    syncSessionActiveClips(session);
    const activeClips = getActiveClips(session);
    if (activeClips.length === 0) return;

    const formatIdsForClip = (clipIndex: number): string[] =>
      perClipFormatIds?.[clipIndex] ?? settings.formats.enabledFormatIds;
    const formatsForClip = (clipIndex: number) =>
      CLIPPER_FORMAT_DEFS.filter((f) => formatIdsForClip(clipIndex).includes(f.id));

    const clipsToRender = activeClips.filter((clip) => formatsForClip(clip.index).length > 0);
    if (clipsToRender.length === 0) {
      setState((prev) => ({ ...prev, error: "Select at least one export format." }));
      return;
    }
    const renderedClipIndices = new Set(clipsToRender.map((clip) => clip.index));

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const initialProgress: Record<string, number | null> = {};
    for (const clip of clipsToRender) {
      for (const f of formatsForClip(clip.index)) initialProgress[`${clip.index}:${f.id}`] = null;
    }

    const stem = baseName(state.sourceFileName ?? "clip");
    const filenameTemplate = settings.formats.filenameTemplate;

    persistMetadata({}, "preview");
    setState((prev) => ({
      ...prev,
      stage: "preview",
      stageMessage: `Rendering ${clipsToRender.length} clip${clipsToRender.length > 1 ? "s" : ""}…`,
      renderProgress: initialProgress,
      error: null,
      clipPreviews: prev.clipPreviews.map((p) =>
        renderedClipIndices.has(p.clip.index)
          ? { ...p, renderStatus: "queued", renderProgress: null, results: [] }
          : p,
      ),
    }));

    const sessionResults: ClipperFormatResult[] = [];
    let failedClipIndex: number | null = null;

    try {
      for (const [queuePosition, clip] of clipsToRender.entries()) {
        if (controller.signal.aborted) return;

        const frameContext = buildFrameContext(session, settings, clip.index);
        if (!frameContext) continue;

        setState((prev) => ({
          ...prev,
          stage: "preview",
          stageMessage: `Rendering clip ${queuePosition + 1} of ${clipsToRender.length}…`,
          stageProgress: null,
          clipPreviews: prev.clipPreviews.map((p) =>
            p.clip.index === clip.index
              ? { ...p, renderStatus: "rendering", renderProgress: 0 }
              : p,
          ),
        }));

        failedClipIndex = clip.index;

        const clipResults = await runRenderClipJob(
          session,
          frameContext,
          {
            projectId: project.id,
            clipIndex: clip.index,
            enabledFormatIds: formatIdsForClip(clip.index),
            filenameStem: stem,
            filenameTemplate,
          },
          reporterRef.current,
          { signal: controller.signal, previewUrls: previewUrlsRef.current },
        );

        for (const r of clipResults) {
          if (r.previewUrl.startsWith("blob:")) {
            previewUrlsRef.current.push(r.previewUrl);
          }
        }
        sessionResults.push(...clipResults);

        setState((prev) => ({
          ...prev,
          exportHistory: appendUniqueExportResults(prev.exportHistory, clipResults),
          clipPreviews: prev.clipPreviews.map((p) =>
            p.clip.index === clip.index
              ? {
                  ...p,
                  renderStatus: "done",
                  renderProgress: 1,
                  results: clipResults,
                }
              : p,
          ),
          renderProgress: {
            ...prev.renderProgress,
            ...Object.fromEntries(
              formatsForClip(clip.index).map((f) => [`${clip.index}:${f.id}`, 1]),
            ),
          },
        }));
      }

      if (controller.signal.aborted) return;

      persistMetadata({}, "done");
      setState((prev) => ({
        ...prev,
        stage: "done",
        stageMessage: "Your clips are ready!",
        error: null,
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      clipperError("pipeline: render failed", error);
      persistMetadata({}, "preview");
      setState((prev) => ({
        ...prev,
        stage: "preview",
        stageMessage: "Render failed — adjust preview and try again",
        stageProgress: null,
        error: error instanceof Error ? error.message : "Render failed.",
        clipPreviews: prev.clipPreviews.map((p) => {
          if (failedClipIndex != null && p.clip.index === failedClipIndex) {
            return { ...p, renderStatus: "error" as const };
          }
          if (p.renderStatus === "rendering") {
            return { ...p, renderStatus: "idle" as const, renderProgress: null };
          }
          if (p.renderStatus === "queued") {
            return { ...p, renderStatus: "idle" as const };
          }
          return p;
        }),
      }));
    }
  }, [persistMetadata, project.id, settings, state.sourceFileName]);

  const rerenderFormat = useCallback(
    async (formatId: string, clipIndex: number) => {
      const session = sessionRef.current;
      const formatDef = getClipperFormatDef(formatId);
      if (!session?.rangeTrimmedFile && !session?.trimmedFile) return;
      if (!formatDef) return;

      const frameContext = buildFrameContext(session, settings, clipIndex);
      if (!frameContext) return;

      const progressKey = `${clipIndex}:${formatId}`;
      setState((prev) => ({
        ...prev,
        renderProgress: { ...prev.renderProgress, [progressKey]: null },
      }));

      const stem = baseName(state.sourceFileName ?? "clip");
      try {
        const result = await runRerenderFormat(
          session,
          formatDef,
          frameContext,
          clipIndex,
          {
            projectId: project.id,
            filenameStem: stem,
            filenameTemplate: settings.formats.filenameTemplate,
          },
          reporterRef.current,
          { signal: abortRef.current?.signal, previewUrls: previewUrlsRef.current },
        );
        if (result.previewUrl.startsWith("blob:")) {
          previewUrlsRef.current.push(result.previewUrl);
        }

        setState((prev) => ({
          ...prev,
          renderProgress: { ...prev.renderProgress, [progressKey]: 1 },
          exportHistory: appendUniqueExportResults(prev.exportHistory, [result]),
          clipPreviews: prev.clipPreviews.map((p) =>
            p.clip.index === clipIndex
              ? {
                  ...p,
                  results: appendUniqueExportResults(p.results, [result]),
                }
              : p,
          ),
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Re-render failed.",
        }));
      }
    },
    [project.id, settings, state.sourceFileName],
  );

  const download = useCallback(
    (result: ClipperFormatResult, sourceName: string | null) => {
      const stem = baseName(sourceName ?? "clip");
      const anchor = document.createElement("a");
      anchor.href = result.previewUrl;
      anchor.download = `${applyFilenameTemplate(
        settings.formats.filenameTemplate,
        stem,
        result.formatId,
        result.clipIndex,
      )}.mp4`;
      anchor.click();
    },
    [settings.formats.filenameTemplate],
  );

  useClipperResume({
    loaded,
    projectId: project.id,
    setState,
    setSettingsState,
    setRangeLocked,
    metadataRef,
    sessionRef,
    abortRef,
    resumeStartedRef,
    loadedResumeKeyRef,
    reporter: reporterRef.current,
    initialState: INITIAL_STATE,
    preparePreviewFromRange,
    confirmRange,
    activeClipIndexRef,
  });

  useEffect(() => {
    if (!loaded) return;
    void hydrateExportsFromDisk();
  }, [hydrateExportsFromDisk, loaded]);

  useEffect(() => {
    if (!loaded) return;
    void fetchClipperExports(project.id)
      .then((exports) => setPersistedExportCount(exports.length))
      .catch(() => setPersistedExportCount(0));
  }, [loaded, project.id]);

  const exportCount = Math.max(state.exportHistory.length, persistedExportCount);

  const refreshExportHistory = useCallback(() => {
    void hydrateExportsFromDisk();
  }, [hydrateExportsFromDisk]);

  useEffect(() => {
    registerClipperPersistenceFlushListeners();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokePreviewUrls();
      clearSession();
      void flushClipperProjectMetadataSave();
      void flushClipperProjectSettingsSave();
    };
  }, [clearSession, revokePreviewUrls]);

  const aiCurrentClipsJsonChars = useMemo(() => {
    const payload = aiClipsMetaRef.current.map((clip) => ({
      segments: payloadClipToWordSegments(clip),
      label: clip.label,
    }));
    return JSON.stringify(payload).length;
  }, [state.aiClipPreviews]);

  return {
    state,
    settings,
    exportCount,
    updateSettings,
    resetSettings,
    selectFile,
    confirmRange,
    clipAgain,
    renderExports,
    rerenderFormat,
    refreshExportHistory,
    reset,
    download,
    setActiveClipIndex,
    setClipSourceMode,
    resegmentAutoParts,
    autoPartsSegmentLengthSec,
    autoPartsResegmenting,
    loadAiChatHistory,
    sendAiClipChatMessage,
    startNewAiChat,
    deleteAiClip,
    deleteAutoPartsClip,
    editClipTranscript,
    undoClipEdit,
    redoClipEdit,
    canUndoClipEdit,
    canRedoClipEdit,
    lastEditedTranscriptRange,
    aiChatMessages,
    aiChatLoading,
    aiChatError,
    aiChatThinking,
    aiChatProgressChars,
    aiChatModel,
    setAiChatModel,
    aiCurrentClipsJsonChars,
    getFrameContext: () => {
      const session = sessionRef.current;
      if (!session) return null;
      return buildFrameContext(session, settings, activeClipIndexRef.current);
    },
    sourceUrl: sessionRef.current?.sourceUrl ?? null,
    rangeLocked,
    disabledCollageRegionIds,
    toggleCollageRegion,
  };
}
