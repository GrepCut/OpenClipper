import type { WordCue } from "../lib/media/transcription-export";
import type { ClipperSettings } from "../settings/settings";
import {
  buildCollageTracksForRegions,
  deriveCollageAspectEligibility,
  deriveCollageTracks,
  deriveTwoSpeakerRegions,
  type CollageAspectEligibility,
  type CollageRegion,
  type CollageTracks,
} from "../engine/reframe/collage";
import type { ClipperGeneratedClip } from "../engine/segmentation";
import { findClipByIndex } from "../engine/segmentation";
import {
  FACE_SAMPLE_INTERVAL_SEC,
  FaceSampleCache,
  deriveSingleFocusTrack,
  hasAnyFaces,
  type CentroidSample,
} from "../engine/reframe";
import type { ClipperFrameContext } from "../engine/render";
import type { AutoFlipStaticFeatureSample, ClipperSmartCropBlob, ImportanceSignalSample, SubjectDetectionSample } from "../shared/smart-crop";
import type { FaceBoxSample } from "../shared/face-samples";
import { groupCaptionWords } from "../engine/transcript";
import type { ClipSourceMode } from "../persistence/project-metadata";
import type { PipelineReporter } from "./reporter";
import type { RmsEnvelope } from "../engine/audio";
import type { FaceActionBenchmark } from "../shared/face-action-benchmark";

/**
 * Handoff from the faces stage to the subjects stage: WinML returns completed
 * subject detections atomically alongside face samples.
 */
export interface PendingSubjectExtraction {
  detections: SubjectDetectionSample[];
  trackerVersion?: "bytetrack-v1";
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
  captionGroupsCache: { wordsPerGroup: number; clip: ClipperGeneratedClip; groups: import("../../lib/media/transcription-export").CaptionGroup[] } | null;
  faceRenderCache: {
    reframeKey: string;
    sampleRevision: number;
    focusTrack: CentroidSample[];
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

/** Cache key for derived face-render tracks from reframe settings + the session's region overrides. */
export function reframeCacheKey(settings: ClipperSettings, disabledCollageRegionIds: string[]): string {
  const { cropMode, facePickStrategy, smoothing, headroom } = settings.reframe;
  return `${cropMode}|${facePickStrategy}|${smoothing}|${headroom}|${[...disabledCollageRegionIds].sort().join(",")}`;
}

/** Creates a face sample cache that reports detection summary via the reporter. */
export function createFaceCache(
  session: ClipperSession,
  reporter: PipelineReporter,
): FaceSampleCache {
  return new FaceSampleCache(FACE_SAMPLE_INTERVAL_SEC, () => {
    const samples = session.faceCache!.sortedSamples();
    if (samples.length === 0) return;
    const hasFaces = hasAnyFaces(samples);
    const hasTwoSpeakers = deriveCollageTracks(samples, "balanced").hasTwoSpeakers;
    reporter.faces(hasFaces, hasTwoSpeakers, session.faceCache!.sampleRevision);
  });
}

/** Resolves or rebuilds cached focus/collage tracks for frame drawing. */
export function resolveFaceRender(
  session: ClipperSession,
  settings: ClipperSettings,
): ClipperFrameContext["faceRender"] {
  const cache = session.faceCache;
  if (!cache) return undefined;

  const disabledCollageRegionIds = session.disabledCollageRegionIds ?? [];
  const reframeKey = reframeCacheKey(settings, disabledCollageRegionIds);
  const sampleRevision = cache.sampleRevision;
  let cached = session.faceRenderCache;
  if (!cached || cached.reframeKey !== reframeKey || cached.sampleRevision !== sampleRevision) {
    const samples = cache.sortedSamples();
    // Collage sees the head-augmented samples so profile faces still open a
    // split; the single-focus track keeps real face detections only.
    const collageSamples = session.collageFaceSamples ?? samples;
    const collageRegions = deriveTwoSpeakerRegions(collageSamples);
    cached = {
      reframeKey,
      sampleRevision,
      focusTrack: deriveSingleFocusTrack(samples, settings.reframe.facePickStrategy, settings.reframe.smoothing),
      collageTracks: buildCollageTracksForRegions(
        collageSamples,
        settings.reframe.smoothing,
        collageRegions,
        disabledCollageRegionIds,
      ),
      collageRegions,
      collageEligibility: deriveCollageAspectEligibility(collageSamples, collageRegions, settings.reframe.headroom),
    };
    session.faceRenderCache = cached;
  }

  return {
    focusTrack: cached.focusTrack,
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
    faceRender: resolveFaceRender(session, settings),
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
