import { z } from "zod";

import type { ClipperSmartCropBlob } from "../shared/smart-crop.util";
import { CLIPPER_EXPORT_MANIFEST_VERSION } from "./export-files.types";

const clipperSettingsSchema = z
  .object({
    captions: z
      .object({
        enabled: z.boolean(),
        fontFamily: z.string(),
        fontSize: z.string(),
        position: z.string(),
        wordsPerGroup: z.number(),
        highlightColor: z.string(),
        wrap: z.boolean(),
        uppercase: z.boolean(),
        boxStyle: z.enum(["solid", "outline", "none"]),
        boxOpacity: z.number(),
        disabledForFormatIds: z.array(z.string()),
      })
      .partial()
      .optional(),
    formats: z
      .object({
        enabledFormatIds: z.array(z.string()),
        quality: z.enum(["draft", "standard", "high"]),
        resolutionCap: z.enum(["source", "1080p", "720p"]),
        filenameTemplate: z.string(),
      })
      .partial()
      .optional(),
    audio: z
      .object({
        mute: z.boolean(),
        fadeInSec: z.number(),
        fadeOutSec: z.number(),
        normalize: z.boolean(),
        normalizePreset: z.string(),
        peakCeiling: z.number(),
      })
      .partial()
      .optional(),
    lastDurationPresetSec: z.number().optional(),
  })
  .passthrough();

export function parseStoredClipperSettings(raw: unknown): z.infer<typeof clipperSettingsSchema> | null {
  const result = clipperSettingsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const exportManifestEntrySchema = z.object({
  id: z.string(),
  clipIndex: z.number(),
  formatId: z.string(),
  fileName: z.string(),
  relativePath: z.string(),
  width: z.number(),
  height: z.number(),
  fileSize: z.number(),
  exportedAt: z.string(),
  clipStartSec: z.number().optional(),
  clipEndSec: z.number().optional(),
});

const exportManifestV1EntrySchema = z.object({
  clipIndex: z.number(),
  formatId: z.string(),
  fileName: z.string(),
  relativePath: z.string(),
  width: z.number(),
  height: z.number(),
  fileSize: z.number(),
  updatedAt: z.string(),
});

const exportManifestSchema = z.object({
  version: z.number(),
  exports: z.array(z.unknown()),
});

export function parseClipperExportManifestRaw(raw: unknown): {
  version: number;
  exports: z.infer<typeof exportManifestEntrySchema>[];
} | null {
  const result = exportManifestSchema.safeParse(raw);
  if (!result.success) return null;

  const { version, exports } = result.data;
  if (version === CLIPPER_EXPORT_MANIFEST_VERSION) {
    const parsed = z.array(exportManifestEntrySchema).safeParse(exports);
    return parsed.success ? { version, exports: parsed.data } : null;
  }

  const v1 = z.array(exportManifestV1EntrySchema).safeParse(exports);
  if (!v1.success) return null;
  return {
    version,
    exports: v1.data.map((entry) => ({
      id: "",
      clipIndex: entry.clipIndex,
      formatId: entry.formatId,
      fileName: entry.fileName,
      relativePath: entry.relativePath,
      width: entry.width,
      height: entry.height,
      fileSize: entry.fileSize,
      exportedAt: entry.updatedAt,
    })),
  };
}

export const clipperTrimMetadataSchema = z.object({
  clipStart: z.number(),
  clipEnd: z.number(),
});

export function parseClipperTrimMetadata(raw: unknown): z.infer<typeof clipperTrimMetadataSchema> | null {
  const result = clipperTrimMetadataSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const restoredClipAnalysisSchema = z.object({
  clipStart: z.number(),
  clipEnd: z.number(),
  samples: z.array(z.unknown()),
  version: z.string().optional(),
});

export function parseRestoredClipAnalysisBlob(raw: unknown): {
  clipStart: number;
  clipEnd: number;
  samples: unknown[];
  version?: string;
} | null {
  const result = restoredClipAnalysisSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const restoredSmartCropSchema = z.object({
  clipStart: z.number(),
  clipEnd: z.number(),
  analyzerVersion: z.string().optional(),
  cameraSmoothing: z.enum(["smooth", "balanced", "snappy"]).optional(),
  aspectTracks: z
    .record(z.string(), z.object({ samples: z.array(z.unknown()) }))
    .optional(),
  version: z.string().optional(),
});

/** Schema only gates restore eligibility; return raw so layoutTracks etc. survive. */
export function parseRestoredSmartCropBlob(raw: unknown): ClipperSmartCropBlob | null {
  const result = restoredSmartCropSchema.safeParse(raw);
  return result.success ? (raw as ClipperSmartCropBlob) : null;
}
