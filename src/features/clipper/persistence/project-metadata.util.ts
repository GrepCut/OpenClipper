import type { ClipperClipBounds } from "../engine/types/segmentation.types";
import { normalizeAutoPartsSegmentLengthSec } from "../engine/segmentation";
import {
  mergeClipperSettings,
  type ClipperSettings,
} from "../settings/settings.util";
import { loadClipperSettings } from "../settings/settings-storage.util";
import {
  isClipperPreviewReadyStage,
  parseClipperStage,
  type ClipperStage,
} from "../shared/stages.util";
import { parseClipperClipBoundsList } from "./parse-clipper-clip-bounds.util";

export const CLIPPER_METADATA_VERSION = 1 as const;

export type ClipSourceMode = "auto-parts" | "ai" | "manual";

export function parseClipSourceMode(value: unknown): ClipSourceMode | undefined {
  if (value === "ai" || value === "auto-parts" || value === "manual") return value;
  return undefined;
}

export type AutoPartsSegmentLengthSec = number;

export interface ClipperProjectMetadata {
  version: typeof CLIPPER_METADATA_VERSION;
  stage: ClipperStage;
  sourceMediaFileId: string | null;
  clipStart: number;
  clipEnd: number | null;
  /** Legacy jsonb field — project settings are stored in DB; parsed only for migration. */
  settings?: ClipperSettings;
  transcribedClipStart?: number;
  transcribedClipEnd?: number;
  /** Legacy jsonb fields — clips now live in clipper-clips; kept for one-time migration. */
  generatedClips?: ClipperClipBounds[];
  aiGeneratedClips?: ClipperClipBounds[];
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

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function parseClipperProjectMetadata(
  raw: Record<string, unknown> | null | undefined,
): ClipperProjectMetadata {
  const defaults = createDefaultClipperMetadata();
  if (!raw || typeof raw !== "object") return defaults;
  if (raw.version !== CLIPPER_METADATA_VERSION) return defaults;

  return {
    version: CLIPPER_METADATA_VERSION,
    stage: parseClipperStage(raw.stage) ?? defaults.stage,
    sourceMediaFileId:
      typeof raw.sourceMediaFileId === "string"
        ? raw.sourceMediaFileId
        : raw.sourceMediaFileId === null
          ? null
          : defaults.sourceMediaFileId,
    clipStart: typeof raw.clipStart === "number" ? raw.clipStart : defaults.clipStart,
    clipEnd:
      typeof raw.clipEnd === "number"
        ? raw.clipEnd
        : raw.clipEnd === null
          ? null
          : defaults.clipEnd,
    settings:
      raw.settings != null && typeof raw.settings === "object" && !Array.isArray(raw.settings)
        ? mergeClipperSettings(loadClipperSettings(), raw.settings as Partial<ClipperSettings>)
        : undefined,
    transcribedClipStart: parseOptionalNumber(raw.transcribedClipStart),
    transcribedClipEnd: parseOptionalNumber(raw.transcribedClipEnd),
    generatedClips: parseClipperClipBoundsList(raw.generatedClips),
    aiGeneratedClips: parseClipperClipBoundsList(raw.aiGeneratedClips),
    clipSourceMode: parseClipSourceMode(raw.clipSourceMode),
    activeClipIndex: parseOptionalNumber(raw.activeClipIndex),
    autoPartsSegmentLengthSec:
      typeof raw.autoPartsSegmentLengthSec === "number"
        ? normalizeAutoPartsSegmentLengthSec(raw.autoPartsSegmentLengthSec)
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
