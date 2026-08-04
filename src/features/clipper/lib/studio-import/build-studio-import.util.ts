import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resolveAutoFlipCropTrack } from "../../engine/autoflip/build-track.util";
import type { ClipperGeneratedClip } from "../../engine/segmentation";
import type { ClipperFrameContext } from "../../engine/types/render.types";
import { resolveCaptionPreset } from "../captions/caption-presets.util";
import {
  canonicalFormatDims,
  getClipperFormatDef,
  type ClipperFormatDef,
} from "../../shared/formats.util";
import {
  isClipperRuntimeSmartCropBlob,
  type ClipperFrameAnalysis,
  type NormalizedBox,
} from "../../shared/smart-crop.util";
import type { ClipperSettings } from "../../settings/settings.util";
import { isTauri } from "../../../../shared/utils/platform.util";
import { appToast } from "../../../../shared/utils/toast.service";
import { openExternalAuthUrl } from "../../../../shared/utils/desktop-auth.util";
import {
  CLIPPER_STUDIO_IMPORT_MANIFEST_FILE,
  CLIPPER_TRIMMED_SEGMENT_FILE,
} from "../../platform/native-source.util";
import {
  CLIPPER_STUDIO_IMPORT_VERSION,
  type ClipperStudioCropSample,
  type ClipperStudioImportV1,
  type ClipperStudioNormalizedBox,
} from "./clipper-studio-import.types";

export const DEFAULT_STUDIO_IMPORT_MANIFEST_NAME = CLIPPER_STUDIO_IMPORT_MANIFEST_FILE;

function toBox(box: NormalizedBox): ClipperStudioNormalizedBox {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

function resolvePrimaryFormat(
  settings: ClipperSettings,
  preferredFormatId?: string,
): ClipperFormatDef {
  if (preferredFormatId) {
    const preferred = getClipperFormatDef(preferredFormatId);
    if (preferred) return preferred;
  }
  const enabled = settings.formats.enabledFormatIds
    .map((id) => getClipperFormatDef(id))
    .filter((f): f is ClipperFormatDef => Boolean(f));
  const vertical = enabled.find((f) => f.aspectId === "9-16");
  return vertical ?? enabled[0] ?? getClipperFormatDef("tiktok")!;
}

function extractCropTrack(
  analysis: ClipperFrameAnalysis | null | undefined,
  formatId: string,
  aspectId: string,
): ClipperStudioCropSample[] {
  if (!analysis) return [];

  if (isClipperRuntimeSmartCropBlob(analysis)) {
    const track =
      analysis.layoutTracks[aspectId] ??
      analysis.layoutTracks[formatId] ??
      analysis.layoutTracks.default ??
      Object.values(analysis.layoutTracks)[0];
    if (!track?.samples?.length) return [];
    return track.samples
      .map((sample) => {
        const viewport = sample.viewports?.[0];
        if (!viewport) return null;
        return { t: sample.t, crop: toBox(viewport) };
      })
      .filter((s): s is ClipperStudioCropSample => s !== null);
  }

  const aspectTrack = resolveAutoFlipCropTrack(analysis, formatId);
  if (aspectTrack?.samples?.length) {
    return aspectTrack.samples.map((sample) => ({
      t: sample.t,
      crop: toBox(sample.crop),
    }));
  }

  const layoutTrack =
    analysis.layoutTracks?.[aspectId] ??
    analysis.layoutTracks?.[formatId] ??
    analysis.layoutTracks?.default;
  if (!layoutTrack?.samples?.length) return [];
  return layoutTrack.samples
    .map((sample) => {
      const viewport = sample.viewports?.[0];
      if (!viewport) return null;
      return { t: sample.t, crop: toBox(viewport) };
    })
    .filter((s): s is ClipperStudioCropSample => s !== null);
}

export interface BuildClipperStudioImportInput {
  clip: ClipperGeneratedClip;
  settings: ClipperSettings;
  frameContext: ClipperFrameContext | null;
  sourceVideoFileName: string;
  preferredFormatId?: string;
  manifestFileName?: string;
}

export function buildClipperStudioImportV1(
  input: BuildClipperStudioImportInput,
): ClipperStudioImportV1 {
  const format = resolvePrimaryFormat(input.settings, input.preferredFormatId);
  const dims = canonicalFormatDims(format);
  const analysis = input.frameContext?.smartCropAnalysis ?? null;
  const preset = resolveCaptionPreset(input.settings.captions.presetId);
  const segments = input.clip.segments?.length
    ? input.clip.segments
    : [{ startSec: input.clip.startSec, endSec: input.clip.endSec }];
  const words = input.clip.words ?? [];
  const captionGroups =
    input.clip.captionGroups?.length > 0
      ? input.clip.captionGroups
      : input.frameContext?.captionGroups ?? [];

  return {
    version: CLIPPER_STUDIO_IMPORT_VERSION,
    createdAt: new Date().toISOString(),
    formatId: format.id,
    aspectId: format.aspectId,
    width: dims.width,
    height: dims.height,
    aspectRatio: dims.width / dims.height,
    sourceVideoFileName: input.sourceVideoFileName,
    manifestFileName: input.manifestFileName ?? DEFAULT_STUDIO_IMPORT_MANIFEST_NAME,
    totalDurationSec: input.clip.durationSec,
    segments: segments.map((s) => ({
      startSec: s.startSec,
      endSec: s.endSec,
    })),
    words: words.map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
    })),
    captionGroups: captionGroups.map((g) => ({
      start: g.start,
      end: g.end,
      words: (g.words ?? []).map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
      })),
    })),
    caption: {
      enabled: input.settings.captions.enabled,
      presetId: preset.id,
      wordsPerGroup: input.settings.captions.wordsPerGroup || preset.wordsPerGroup,
      position: input.settings.captions.position,
      size: input.settings.captions.size,
    },
    cropTrack: extractCropTrack(analysis, format.id, format.aspectId),
    contentRect: analysis?.contentRect ? toBox(analysis.contentRect) : undefined,
    solidBackgroundColor: analysis?.solidBackgroundColor,
  };
}

export function downloadClipperStudioImportJson(
  manifest: ClipperStudioImportV1,
  fileName = DEFAULT_STUDIO_IMPORT_MANIFEST_NAME,
): void {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function getStudioBaseUrl(): string {
  const fromEnv = (import.meta as ImportMeta & { env?: Record<string, string> })
    .env?.VITE_STUDIO_URL;
  return (fromEnv && fromEnv.trim()) || "https://localhost:5173";
}

export function buildStudioImportUrl(manifest: ClipperStudioImportV1): string {
  const base = getStudioBaseUrl().replace(/\/+$/, "");
  const params = new URLSearchParams({
    clipperImport: "1",
    manifest: manifest.manifestFileName,
    videoHint: manifest.sourceVideoFileName,
    formatId: manifest.formatId,
    aspect: `${manifest.width}x${manifest.height}`,
  });
  if (manifest.projectDataDir) {
    params.set("dataDir", manifest.projectDataDir);
  }
  return `${base}/from-clipper?${params.toString()}`;
}

async function stageManifestForStudioImport(
  projectId: string,
  manifest: ClipperStudioImportV1,
): Promise<ClipperStudioImportV1> {
  const fileName = manifest.manifestFileName || DEFAULT_STUDIO_IMPORT_MANIFEST_NAME;
  const videoFileName = manifest.sourceVideoFileName || CLIPPER_TRIMMED_SEGMENT_FILE;

  // Chrome blocks FSA under AppData — stage into Documents/OpenClipper/studio-import.
  const staged = await invoke<{
    projectDataDir: string;
    manifestAbsolutePath: string;
    videoAbsolutePath: string;
  }>("stage_clipper_studio_import", {
    projectId,
    manifestFileName: fileName,
    videoFileName,
    manifestContents: JSON.stringify(manifest, null, 2),
  });

  return {
    ...manifest,
    projectDataDir: staged.projectDataDir,
    manifestAbsolutePath: staged.manifestAbsolutePath,
    videoAbsolutePath: staged.videoAbsolutePath,
  };
}

async function openStudioUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await openUrl(url);
      return;
    } catch (err) {
      console.warn("[OpenInStudio] plugin openUrl failed, trying fallback", err);
      await openExternalAuthUrl(url);
      return;
    }
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error(
      "Browser blocked the Studio popup. Allow popups for this site, or open Studio manually at " +
        url,
    );
  }
}

export interface OpenClipInStudioOptions {
  projectId?: string;
}

/**
 * Persist the import manifest (Chrome-grantable Documents staging when possible) and open Studio.
 */
export async function openClipInStudio(
  manifest: ClipperStudioImportV1,
  options?: OpenClipInStudioOptions,
): Promise<void> {
  const fileName = manifest.manifestFileName || DEFAULT_STUDIO_IMPORT_MANIFEST_NAME;
  let resolved = manifest;
  const projectId = options?.projectId?.trim();

  console.info("[OpenInStudio] start", {
    fileName,
    projectId: projectId || null,
    segments: manifest.segments.length,
    cropSamples: manifest.cropTrack.length,
    isTauri: isTauri(),
  });

  try {
    if (isTauri() && projectId) {
      resolved = await stageManifestForStudioImport(projectId, manifest);
    } else {
      downloadClipperStudioImportJson(resolved, fileName);
    }

    const url = buildStudioImportUrl(resolved);
    console.info("[OpenInStudio] opening", {
      url,
      projectDataDir: resolved.projectDataDir ?? null,
    });
    await openStudioUrl(url);

    if (resolved.projectDataDir) {
      appToast.success(
        "Opening Studio",
        "Grant the Documents\\OpenClipper\\studio-import folder — Chrome cannot open AppData.",
      );
    } else {
      appToast.success(
        "Opening Studio",
        `Select ${fileName} and clip-trimmed.mp4 when Studio asks for files.`,
      );
    }
    console.info("[OpenInStudio] opened", url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[OpenInStudio] failed", error);
    appToast.error("Could not open Studio", message);
    throw error;
  }
}
