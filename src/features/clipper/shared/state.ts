import type { CaptionGroup, WordCue } from "../lib/media/transcription-export";
import type { ClipperSettings } from "../settings/settings";
import type { ClipperPlatform } from "./formats";
import type { ClipperStage } from "./stages";
import type { ClipperGeneratedClip } from "../engine/clip-segmentation";
import type { ClipSourceMode } from "../persistence/project-metadata";

export type ClipperClipRenderStatus = "idle" | "queued" | "rendering" | "done" | "error";

export interface ClipperClipPreview {
  clip: ClipperGeneratedClip;
  renderStatus: ClipperClipRenderStatus;
  renderProgress: number | null;
  results: ClipperFormatResult[];
}

export interface ClipperFormatResult {
  id: string;
  formatId: string;
  platform: ClipperPlatform;
  label: string;
  width: number;
  height: number;
  fileSize: number;
  previewUrl: string;
  clipIndex: number;
  exportedAt: string;
  isMissing?: boolean;
  clipStartSec?: number;
  clipEndSec?: number;
  relativePath?: string;
  displayPath?: string;
  filePath?: string;
  /** Present only for in-memory fallback exports. */
  blob?: Blob;
  file?: File;
}

export interface ClipperPipelineState {
  stage: ClipperStage;
  stageMessage: string;
  renderProgress: Record<string, number | null>;
  /** Persisted export history from disk/DB — shown in Your exports. */
  exportHistory: ClipperFormatResult[];
  /** Shared trimmed range video URL for multi-clip preview playback. */
  rangeTrimmedVideoUrl: string | null;
  clipPreviews: ClipperClipPreview[];
  autoPartsClipPreviews: ClipperClipPreview[];
  aiClipPreviews: ClipperClipPreview[];
  clipSourceMode: ClipSourceMode;
  activeClipIndex: number;
  error: string | null;
  /** Duration of the selected source range (clipEnd - clipStart), for UI display. */
  clipDuration: number | null;
  sourceFileName: string | null;
  /** Full duration of the originally uploaded source, known once probed. */
  sourceDuration: number | null;
  clipStart: number;
  clipEnd: number | null;
  /** Set once the whole-range face pre-analysis (stage "analyzing-faces") completes. */
  hasDetectedFaces: boolean | null;
  hasTwoSpeakers: boolean | null;
  /** Monotonic counter bumped whenever new face samples resolve — lets UI re-derive collage regions without depending on hasTwoSpeakers alone. */
  faceSampleRevision: number;
  /** Full transcript for the selected range, 0-based relative to range start. */
  rangeWords: WordCue[];
  /** 0..1 progress through the whole-range face pre-analysis pass, or null when not running. */
  faceAnalysisProgress: number | null;
  subjectAnalysisProgress: number | null;
  /** Smoothed seconds-remaining estimate for the native face+subject extraction decode; null when unknown or not running (native path only). */
  analysisEtaSeconds: number | null;
  /** 0..1 progress for the active pipeline stage (upload, transcribe, trim prep), or null. */
  stageProgress: number | null;
}

/** Words shown per caption group before switching to the next on-screen phrase (fallback default). */
export const CLIPPER_CAPTION_WORDS_PER_GROUP = 5;

export type { ClipperSettings, ClipperGeneratedClip, WordCue, CaptionGroup, ClipSourceMode };
