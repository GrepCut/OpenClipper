import type { ClipperStage } from "../shared/stages.util";
import { normalizeAutoPartsSegmentLengthSec } from "../engine/segmentation";
import {
  DEFAULT_CLIPPER_SETTINGS,
  mergeClipperSettings,
  type ClipperSettings,
  type ClipperTranscriptionEngine,
} from "../settings/settings.util";
import { loadClipperSettings } from "../settings/settings-storage.util";
import { isClipperPreviewReadyStage } from "../shared/stages.util";

export const CLIPPER_METADATA_VERSION = 1 as const;

export type ClipSourceMode = "auto-parts" | "ai";

export type AutoPartsSegmentLengthSec = number;

export interface ClipperProjectMetadata {
  version: typeof CLIPPER_METADATA_VERSION;
  stage: ClipperStage;
  sourceMediaFileId: string | null;
  clipStart: number;
  clipEnd: number | null;
  /** Legacy jsonb field — project settings are stored in DB; parsed only for migration. */
  settings?: ClipperSettings;
  wordsPerGroupAtTranscribe?: number;
  transcribedClipStart?: number;
  transcribedClipEnd?: number;
  transcriptionEngine?: ClipperTranscriptionEngine;
  /** Legacy jsonb fields — manual/AI clips are now stored in dedicated clipper_clip tables; kept optionally readable only for one-time server-side migration. */
  generatedClips?: Array<{ index: number; startSec: number; endSec: number }>;
  aiGeneratedClips?: Array<Record<string, unknown>>;
  clipSourceMode?: ClipSourceMode;
  activeClipIndex?: number;
  autoPartsSegmentLengthSec?: AutoPartsSegmentLengthSec;
}

export function createDefaultClipperMetadata(): ClipperProjectMetadata {
  return {
    version: CLIPPER_METADATA_VERSION,
    stage: "idle",
    sourceMediaFileId: null,
    clipStart: 0,
    clipEnd: null,
  };
}

/** Settings template for new projects (localStorage); not written to project.metadata jsonb. */
export function createDefaultClipperProjectSettings(): ClipperSettings {
  return loadClipperSettings();
}

export function parseClipperProjectMetadata(
  raw: Record<string, unknown> | null | undefined,
): ClipperProjectMetadata {
  const defaults = createDefaultClipperMetadata();
  if (!raw || typeof raw !== "object") return defaults;

  const partial = raw as Partial<ClipperProjectMetadata>;
  if (partial.version !== CLIPPER_METADATA_VERSION) return defaults;

  return {
    version: CLIPPER_METADATA_VERSION,
    stage: partial.stage ?? defaults.stage,
    sourceMediaFileId:
      typeof partial.sourceMediaFileId === "string"
        ? partial.sourceMediaFileId
        : partial.sourceMediaFileId === null
          ? null
          : defaults.sourceMediaFileId,
    clipStart: typeof partial.clipStart === "number" ? partial.clipStart : defaults.clipStart,
    clipEnd:
      typeof partial.clipEnd === "number"
        ? partial.clipEnd
        : partial.clipEnd === null
          ? null
          : defaults.clipEnd,
    settings: partial.settings
      ? mergeClipperSettings(loadClipperSettings(), partial.settings)
      : undefined,
    wordsPerGroupAtTranscribe:
      typeof partial.wordsPerGroupAtTranscribe === "number"
        ? partial.wordsPerGroupAtTranscribe
        : undefined,
    transcribedClipStart:
      typeof partial.transcribedClipStart === "number"
        ? partial.transcribedClipStart
        : undefined,
    transcribedClipEnd:
      typeof partial.transcribedClipEnd === "number" ? partial.transcribedClipEnd : undefined,
    transcriptionEngine:
      partial.transcriptionEngine === "parakeet_local" ||
      partial.transcriptionEngine === "api"
        ? partial.transcriptionEngine
        : undefined,
    generatedClips: Array.isArray(partial.generatedClips)
      ? partial.generatedClips.filter(
          (c): c is { index: number; startSec: number; endSec: number } =>
            c != null &&
            typeof c === "object" &&
            typeof (c as { index?: unknown }).index === "number" &&
            typeof (c as { startSec?: unknown }).startSec === "number" &&
            typeof (c as { endSec?: unknown }).endSec === "number",
        )
      : undefined,
    aiGeneratedClips: Array.isArray(partial.aiGeneratedClips)
      ? partial.aiGeneratedClips.filter(
          (c): c is Record<string, unknown> =>
            c != null &&
            typeof c === "object" &&
            typeof (c as { index?: unknown }).index === "number" &&
            typeof (c as { startSec?: unknown }).startSec === "number" &&
            typeof (c as { endSec?: unknown }).endSec === "number",
        )
      : undefined,
    clipSourceMode:
      partial.clipSourceMode === "ai"
        ? "ai"
        : partial.clipSourceMode === "auto-parts" || partial.clipSourceMode === "manual"
          ? "auto-parts"
          : undefined,
    activeClipIndex:
      typeof partial.activeClipIndex === "number" ? partial.activeClipIndex : undefined,
    autoPartsSegmentLengthSec:
      typeof partial.autoPartsSegmentLengthSec === "number"
        ? normalizeAutoPartsSegmentLengthSec(partial.autoPartsSegmentLengthSec)
        : undefined,
  };
}

export function clipperMetadataToRecord(
  metadata: ClipperProjectMetadata,
): Record<string, unknown> {
  const { settings: _legacySettings, ...rest } = metadata;
  return { ...rest };
}

export function hasMatchingTranscriptionMarkers(metadata: ClipperProjectMetadata): boolean {
  return (
    metadata.transcribedClipStart === metadata.clipStart &&
    metadata.transcribedClipEnd === metadata.clipEnd
  );
}

/** Whether saved transcription can be sliced for the current clip window. */
export function canRestoreTranscriptionFromMetadata(metadata: ClipperProjectMetadata): boolean {
  const clipDuration =
    metadata.clipEnd != null ? metadata.clipEnd - metadata.clipStart : null;
  if (!metadata.sourceMediaFileId || clipDuration == null || clipDuration <= 0) {
    return false;
  }
  if (hasMatchingTranscriptionMarkers(metadata)) return true;
  return (
    isClipperPreviewReadyStage(metadata.stage) &&
    metadata.transcribedClipStart == null &&
    metadata.transcribedClipEnd == null
  );
}
