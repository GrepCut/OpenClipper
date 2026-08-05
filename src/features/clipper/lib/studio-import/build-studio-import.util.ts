import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resolveAutoFlipCropTrack } from "../../engine/autoflip/build-track.util";
import type { ClipperGeneratedClip } from "../../engine/segmentation";
import type { ClipperFrameContext } from "../../engine/types/render.types";
import { resolveCaptionPreset } from "../captions/caption-presets.util";
import {
  resolveNonOverlappingCaptionGroups,
  wordCuesToCaptionGroups,
} from "../media/transcription-export.util";
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
  extractClipperStudioThumbnails,
} from "../../persistence/project-data-files.util";
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

type LayoutTrackLike = {
  samples?: Array<{
    t: number;
    viewports?: NormalizedBox[];
    crop?: NormalizedBox;
    cut?: boolean;
  }>;
};

function firstNonEmptyTrack(
  tracks: Record<string, LayoutTrackLike> | undefined,
  preferredKeys: string[],
): LayoutTrackLike | undefined {
  if (!tracks) return undefined;
  for (const key of preferredKeys) {
    const track = tracks[key];
    if (track?.samples?.length) return track;
  }
  return Object.values(tracks).find((track) => Boolean(track?.samples?.length));
}

function samplesFromLayoutTrack(
  track: LayoutTrackLike,
): ClipperStudioCropSample[] {
  if (!track.samples?.length) return [];
  return track.samples
    .map((sample) => {
      const viewport = sample.viewports?.[0] ?? sample.crop;
      if (!viewport) return null;
      const out: ClipperStudioCropSample = {
        t: sample.t,
        crop: toBox(viewport),
      };
      if (sample.cut) out.cut = true;
      return out;
    })
    .filter((s): s is ClipperStudioCropSample => s !== null);
}

function extractCropTrack(
  analysis: ClipperFrameAnalysis | null | undefined,
  formatId: string,
  aspectId: string,
): ClipperStudioCropSample[] {
  if (!analysis) return [];

  if (isClipperRuntimeSmartCropBlob(analysis)) {
    const track = firstNonEmptyTrack(analysis.layoutTracks, [
      aspectId,
      formatId,
      "default",
    ]);
    return track ? samplesFromLayoutTrack(track) : [];
  }

  const aspectTrack =
    resolveAutoFlipCropTrack(analysis, formatId) ??
    resolveAutoFlipCropTrack(analysis, aspectId) ??
    firstNonEmptyTrack(
      analysis.aspectTracks as Record<string, LayoutTrackLike> | undefined,
      [formatId, aspectId, "default"],
    );
  if (aspectTrack && "samples" in aspectTrack && aspectTrack.samples?.length) {
    const legacySamples = aspectTrack.samples as Array<{
      t: number;
      crop?: NormalizedBox;
      viewports?: NormalizedBox[];
      cut?: boolean;
    }>;
    const mapped = legacySamples
      .map((sample) => {
        const box = sample.crop ?? sample.viewports?.[0];
        if (!box) return null;
        const out: ClipperStudioCropSample = {
          t: sample.t,
          crop: toBox(box),
        };
        if (sample.cut) out.cut = true;
        return out;
      })
      .filter((s): s is ClipperStudioCropSample => s !== null);
    if (mapped.length) return mapped;
  }

  const layoutTrack = firstNonEmptyTrack(analysis.layoutTracks, [
    aspectId,
    formatId,
    "default",
  ]);
  return layoutTrack ? samplesFromLayoutTrack(layoutTrack) : [];
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
  const cropTrack = extractCropTrack(analysis, format.id, format.aspectId);
  const preset = resolveCaptionPreset(input.settings.captions.presetId);
  const segments = input.clip.segments?.length
    ? input.clip.segments
    : [{ startSec: input.clip.startSec, endSec: input.clip.endSec }];
  const words = input.clip.words ?? [];
  const wordsPerGroup =
    input.settings.captions.wordsPerGroup || preset.wordsPerGroup;
  const rawCaptionGroups =
    input.clip.captionGroups?.length > 0
      ? input.clip.captionGroups
      : (input.frameContext?.captionGroups ?? []);
  const captionGroups =
    words.length > 0
      ? wordCuesToCaptionGroups(words, wordsPerGroup)
      : resolveNonOverlappingCaptionGroups(rawCaptionGroups);

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
      wordsPerGroup: wordsPerGroup,
      position: input.settings.captions.position,
      size: input.settings.captions.size,
    },
    cropTrack,
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

const DEFAULT_CLIPPER_LOCAL_HTTP_PORT = 12742;

async function resolveClipperLocalHttpPort(): Promise<number> {
  if (!isTauri()) return DEFAULT_CLIPPER_LOCAL_HTTP_PORT;
  try {
    const port = await invoke<number>("get_open_clipper_local_http_port");
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_CLIPPER_LOCAL_HTTP_PORT;
  } catch {
    return DEFAULT_CLIPPER_LOCAL_HTTP_PORT;
  }
}

export function buildStudioImportUrl(
  manifest: ClipperStudioImportV1,
  options?: { projectId?: string; clipperPort?: number },
): string {
  const base = getStudioBaseUrl().replace(/\/+$/, "");
  const params = new URLSearchParams({
    clipperImport: "1",
    manifest: manifest.manifestFileName,
    videoHint: manifest.sourceVideoFileName,
    formatId: manifest.formatId,
    aspect: `${manifest.width}x${manifest.height}`,
  });
  const id = options?.projectId?.trim();
  if (id) {
    params.set("projectId", id);
  }
  const port = options?.clipperPort ?? DEFAULT_CLIPPER_LOCAL_HTTP_PORT;
  params.set("clipperPort", String(port));
  return `${base}/from-clipper?${params.toString()}`;
}

async function stageManifestForStudioImport(
  projectId: string,
  manifest: ClipperStudioImportV1,
): Promise<ClipperStudioImportV1> {
  const fileName = manifest.manifestFileName || DEFAULT_STUDIO_IMPORT_MANIFEST_NAME;
  const videoFileName = manifest.sourceVideoFileName || CLIPPER_TRIMMED_SEGMENT_FILE;

  const projectDataDir = await invoke<string>("ensure_clipper_project_data_dir", {
    projectId,
  });

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

  const resolvedDataDir = staged.projectDataDir || projectDataDir;
  if (/[/\\]studio-import[/\\]?$/i.test(resolvedDataDir.replace(/[/\\]+$/, ""))) {
    throw new Error(
      "Studio import resolved to obsolete studio-import staging. Restart Open Clipper so it uses Documents\\OpenClipper\\projects\\{id}\\data.",
    );
  }

  return {
    ...manifest,
    projectDataDir: resolvedDataDir,
    manifestAbsolutePath:
      staged.manifestAbsolutePath || `${resolvedDataDir}\\${fileName}`,
    videoAbsolutePath:
      staged.videoAbsolutePath || `${resolvedDataDir}\\${videoFileName}`,
  };
}

async function openStudioUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await openUrl(url);
      return;
    } catch {
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

export type OpenInStudioPhase =
  | "preparing"
  | "thumbnails"
  | "staging"
  | "opening";

export interface OpenInStudioProgress {
  phase: OpenInStudioPhase;
  ratio: number;
}

export interface OpenClipInStudioOptions {
  projectId?: string;
  onProgress?: (progress: OpenInStudioProgress) => void;
}

const PHASE_RANGES: Record<OpenInStudioPhase, { start: number; end: number }> = {
  preparing: { start: 0, end: 0.15 },
  thumbnails: { start: 0.15, end: 0.85 },
  staging: { start: 0.85, end: 0.95 },
  opening: { start: 0.95, end: 1 },
};

function mapPhaseProgress(
  phase: OpenInStudioPhase,
  localRatio: number,
): OpenInStudioProgress {
  const range = PHASE_RANGES[phase];
  const t = Math.max(0, Math.min(1, localRatio));
  return {
    phase,
    ratio: range.start + (range.end - range.start) * t,
  };
}

export async function openClipInStudio(
  manifest: ClipperStudioImportV1,
  options?: OpenClipInStudioOptions,
): Promise<void> {
  const fileName = manifest.manifestFileName || DEFAULT_STUDIO_IMPORT_MANIFEST_NAME;
  let resolved = manifest;
  const projectId = options?.projectId?.trim();
  const report = (phase: OpenInStudioPhase, localRatio: number) => {
    options?.onProgress?.(mapPhaseProgress(phase, localRatio));
  };

  try {
    report("preparing", 1);

    if (isTauri() && projectId) {
      let withThumbs = manifest;
      try {
        report("thumbnails", 0);
        const thumbs = await extractClipperStudioThumbnails(
          projectId,
          Math.max(0.1, manifest.totalDurationSec),
          false,
          (thumbRatio) => report("thumbnails", thumbRatio),
        );
        report("thumbnails", 1);
        if (thumbs && thumbs.count > 0) {
          withThumbs = {
            ...manifest,
            thumbnails: {
              indexFileName: thumbs.indexFileName,
              packFileName: thumbs.packFileName,
              intervalSec: thumbs.intervalSec,
              height: thumbs.height,
              count: thumbs.count,
            },
          };
        }
      } catch {
        report("thumbnails", 1);
      }
      report("staging", 0);
      resolved = await stageManifestForStudioImport(projectId, withThumbs);
      report("staging", 1);
    } else {
      downloadClipperStudioImportJson(resolved, fileName);
      report("staging", 1);
    }

    report("opening", 0);
    const clipperPort = await resolveClipperLocalHttpPort();
    const url = buildStudioImportUrl(resolved, { projectId, clipperPort });
    await openStudioUrl(url);
    report("opening", 1);

    appToast.success(
      "Opening Studio",
      "Import starts automatically while Open Clipper is running.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appToast.error("Could not open Studio", message);
    throw error;
  }
}
