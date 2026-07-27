import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperSettings } from "../settings/settings.util";
import {
  buildCollageTracksForRegions,
  deriveCollageTracks,
  deriveRegionsFromLayoutTracks,
  type CollageAspectEligibility,
  type CollageRegion,
  type CollageTracks,
} from "../engine/reframe/collage";
import type { ClipperGeneratedClip } from "../engine/segmentation";
import { findClipByIndex } from "../engine/segmentation";
import {
  FACE_SAMPLE_INTERVAL_SEC,
  FaceSampleCache,
  hasAnyFaces,
  type CentroidSample,
} from "../engine/reframe";
import type { ClipperFrameContext } from "../engine/render/index";
import type { AutoFlipStaticFeatureSample, ClipperSmartCropBlob, ImportanceSignalSample, SubjectDetectionSample } from "../shared/smart-crop.util";
import type { FaceBoxSample } from "../shared/face-samples.util";
import { groupCaptionWords } from "../engine/transcript";
import type { ClipSourceMode } from "../persistence/project-metadata.util";
import type { PipelineReporter } from "./reporter.util";
import type { RmsEnvelope } from "../engine/types/audio.types";
import type { FaceActionBenchmark } from "../shared/face-action-benchmark.util";

/**
 * Handoff from the faces stage to the subjects stage: WinML returns completed
 * subject detections atomically alongside face samples.
 */
export interface PendingSubjectExtraction {
  detections: SubjectDetectionSample[];
  trackerVersion?: "bytetrack-v1" | "bytetrack-v2";
  sceneCutTimestamps: number[];
  sourceFrameRate?: number;
  hasSolidColorBackground?: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number } | null;
  staticFeatureSamples?: AutoFlipStaticFeatureSample[];
  importanceSignals?: ImportanceSignalSample[];
  contentRect?: { x: number; y: number; width: number; height: number };
  degradedReason?: string;
}

export interface ClipperSession {
  sourceFile: File;
  sourceUrl: string;
  sourceDuration: number;
  mediaFileId: string;
  /** Trimmed file for the full selected source range (used for preview + sub-trim at render). */
  rangeTrimmedFile: File | null;
  rangeTrimmedVideoUrl: string | null;
  /** @deprecated Alias for rangeTrimmedFile — kept for stages that read trimmedFile. */
  trimmedFile: File | null;
  trimmedVideoUrl: string | null;
  /** Full transcription for the selected range (0-based relative to range start). */
  rangeWords: WordCue[];
  words: WordCue[];
  audioEnvelope?: RmsEnvelope | null;
  /** Source timeline bounds for the selected range. */
  rangeStart: number;
  rangeEnd: number;
  clipStart: number;
  clipEnd: number;
  autoPartsClips: ClipperGeneratedClip[];
  aiClips: ClipperGeneratedClip[];
  clipSourceMode: ClipSourceMode;
  /** Ids of auto-detected two-speaker regions (see CollageRegion) where the user turned split-screen off. */
  disabledCollageRegionIds: string[];
  /** Active clip set used for preview/render (auto-parts or AI). */
  clips: ClipperGeneratedClip[];
  activeClipIndex: number;
  faceCache: FaceSampleCache | null;
  /** Face samples augmented with person-detector head estimates; consumed only by the collage derivations. */
  collageFaceSamples?: FaceBoxSample[] | null;
  smartCropAnalysis?: ClipperSmartCropBlob | null;
  /** Set by the faces stage when it also ran subject/motion extraction (see `PendingSubjectExtraction`); consumed and cleared by the subjects stage. */
  pendingSubjectExtraction?: PendingSubjectExtraction | null;
  /** Wall-clock phase timings for "Detect faces & track action"; finalized in the subjects stage. */
  faceActionBenchmark?: FaceActionBenchmark | null;
  /** Cached keyframe timestamps from the trimmed range file — reused for live auto-parts re-segmentation. */
  keyframeTimestamps?: number[];
  captionGroupsCache: { wordsPerGroup: number; clip: ClipperGeneratedClip; groups: import("../lib/media/transcription-export.util").CaptionGroup[] } | null;
  faceRenderCache: {
    collageRegionKey: string;
    sampleRevision: number;
    /** Invalidates when AutoFlip layout tracks change (marker source of truth). */
    layoutKey: string;
    collageTracks: CollageTracks;
    collageRegions: CollageRegion[];
    collageEligibility: CollageAspectEligibility;
  } | null;
}

/** Ensures legacy/in-memory sessions have auto-parts/AI clip fields after hot reload. */
export function normalizeClipperSession(session: ClipperSession): ClipperSession {
  const legacyClips = session.clips ?? [];
  session.autoPartsClips = session.autoPartsClips ?? legacyClips;
  session.aiClips = session.aiClips ?? [];
  session.clipSourceMode = session.clipSourceMode ?? "auto-parts";
  session.disabledCollageRegionIds = session.disabledCollageRegionIds ?? [];
  session.smartCropAnalysis = session.smartCropAnalysis ?? null;
  session.clips =
    session.clipSourceMode === "ai" ? session.aiClips : session.autoPartsClips;
  return session;
}

/** Cache key for derived face-render tracks from the session's collage region overrides. */
export function collageRegionCacheKey(disabledCollageRegionIds: string[]): string {
  return [...disabledCollageRegionIds].sort().join(",");
}

/** Cache key for layout-derived collage regions (AutoFlip split markers). */
export function layoutRegionsCacheKey(
  smartCropAnalysis: ClipperSmartCropBlob | null | undefined,
): string {
  if (!smartCropAnalysis?.layoutTracks) return "none";
  const sampleCount = Object.values(smartCropAnalysis.layoutTracks).reduce(
    (n, track) => n + (track.samples?.length ?? 0),
    0,
  );
  return `${smartCropAnalysis.analyzerVersion ?? ""}|${sampleCount}`;
}

const EMPTY_COLLAGE_ELIGIBILITY: CollageAspectEligibility = {
  "16-9": [],
  "9-16": [],
  "1-1": [],
  "4-5": [],
};

/** Creates a face sample cache that reports detection summary via the reporter. */
export function createFaceCache(
  session: ClipperSession,
  reporter: PipelineReporter,
): FaceSampleCache {
  return new FaceSampleCache(FACE_SAMPLE_INTERVAL_SEC, () => {
    const samples = session.faceCache!.sortedSamples();
    if (samples.length === 0) return;
    const hasFaces = hasAnyFaces(samples);
    const hasTwoSpeakers = deriveCollageTracks(samples).hasTwoSpeakers;
    reporter.faces(hasFaces, hasTwoSpeakers, session.faceCache!.sampleRevision);
  });
}

/** Resolves or rebuilds cached focus/collage tracks for frame drawing. */
export function resolveFaceRender(
  session: ClipperSession,
): ClipperFrameContext["faceRender"] {
  const cache = session.faceCache;
  if (!cache) return undefined;

  const disabledCollageRegionIds = session.disabledCollageRegionIds ?? [];
  const collageRegionKey = collageRegionCacheKey(disabledCollageRegionIds);
  const sampleRevision = cache.sampleRevision;
  const layoutKey = layoutRegionsCacheKey(session.smartCropAnalysis);
  let cached = session.faceRenderCache;
  if (
    !cached ||
    cached.collageRegionKey !== collageRegionKey ||
    cached.sampleRevision !== sampleRevision ||
    cached.layoutKey !== layoutKey
  ) {
    const samples = cache.sortedSamples();
    const collageSamples = session.collageFaceSamples ?? samples;
    // Single source of truth: AutoFlip layoutTracks (same as preview split).
    const collageRegions = deriveRegionsFromLayoutTracks(session.smartCropAnalysis);
    cached = {
      collageRegionKey,
      sampleRevision,
      layoutKey,
      collageTracks: buildCollageTracksForRegions(
        collageSamples,
        collageRegions,
        disabledCollageRegionIds,
      ),
      collageRegions,
      collageEligibility: EMPTY_COLLAGE_ELIGIBILITY,
    };
    session.faceRenderCache = cached;
  }

  return {
    collageTracks: cached.collageTracks,
    collageRegions: cached.collageRegions,
    collageEligibility: cached.collageEligibility,
  };
}

/** Builds frame draw context for a specific generated clip within the trimmed range. */
export function buildFrameContext(
  session: ClipperSession,
  settings: ClipperSettings,
  clipIndex = session.activeClipIndex,
): ClipperFrameContext | null {
  if (!session) return null;

  normalizeClipperSession(session);
  const clip = findClipByIndex(getActiveClips(session), clipIndex);
  if (!clip) return null;

  const wordsPerGroup = settings.captions.wordsPerGroup;
  let cached = session.captionGroupsCache;
  if (!cached || cached.wordsPerGroup !== wordsPerGroup || cached.clip !== clip) {
    cached = {
      wordsPerGroup,
      clip,
      groups:
        clip.captionGroups.length > 0
          ? clip.captionGroups
          : groupCaptionWords(clip.words, wordsPerGroup),
    };
    session.captionGroupsCache = cached;
  }

  return {
    settings,
    captionGroups: cached.groups,
    faceCache: session.faceCache,
    faceRender: resolveFaceRender(session),
    smartCropAnalysis: session.smartCropAnalysis,
    disabledCollageRegionIds: session.disabledCollageRegionIds ?? [],
    segments: clip.segments,
  };
}

/** Returns the active clip list based on source mode. */
export function getActiveClips(session: ClipperSession): ClipperGeneratedClip[] {
  const autoPartsClips = session.autoPartsClips ?? session.clips ?? [];
  const aiClips = session.aiClips ?? [];
  const mode = session.clipSourceMode ?? "auto-parts";
  return mode === "ai" ? aiClips : autoPartsClips;
}

/** Syncs session.clips to the active auto-parts/AI set. */
export function syncSessionActiveClips(session: ClipperSession): void {
  normalizeClipperSession(session);
  session.clips = getActiveClips(session);
}

/** Active generated clip, if any. */
export function getActiveClip(session: ClipperSession): ClipperGeneratedClip | null {
  return findClipByIndex(getActiveClips(session), session.activeClipIndex);
}
