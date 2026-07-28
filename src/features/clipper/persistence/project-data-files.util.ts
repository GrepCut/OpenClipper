import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../shared/utils/platform.util";
import { resolveFilePlayableUrl } from '../persistence/tauri-media.util';
import type { ClipperFaceSamplesBlob } from "../shared/face-samples.util";
import {
  isClipperRuntimeSmartCropBlob,
  type ClipperFrameAnalysis,
  type ClipperSmartCropBlob,
} from "../shared/smart-crop.util";
import { compactSmartCropForRuntime } from "../engine/render/compact-smart-crop.util";
export type { ClipperFaceSamplesBlob };
import { parseClipperTrimMetadata, parseRestoredSmartCropBlob } from "./clipper-persistence-schemas.util";
import { clipperLog, clipperMeasureSync, formatBytes } from "../shared/logger.util";
import { CLIPPER_FACE_ACTION_BENCHMARK_FILE } from "../shared/face-action-benchmark.util";
import { yieldToMain } from "../shared/yield-to-main.util";
import { CLIPPER_TRIMMED_SEGMENT_FILE, pathBackedClipperFile } from "../platform/native-source.util";

export const CLIPPER_FACE_DETECTIONS_FILE = "face_detections.json";
export const CLIPPER_TRIM_METADATA_FILE = "trim_metadata.json";
export const CLIPPER_SMART_CROP_FILE = "smart_crop_analysis.json";
export { CLIPPER_FACE_ACTION_BENCHMARK_FILE };

export interface ClipperTrimMetadata {
  clipStart: number;
  clipEnd: number;
}

export interface ClipperRestoredTrimmedSegment {
  file: File;
  videoUrl: string;
}

export function clipperFaceDataRelativePath(projectId: string): string {
  return `grepcut/projects/${projectId}/data/${CLIPPER_FACE_DETECTIONS_FILE}`;
}

export function clipperSmartCropDataRelativePath(projectId: string): string {
  return `grepcut/projects/${projectId}/data/${CLIPPER_SMART_CROP_FILE}`;
}

export async function writeClipperFaceActionBenchmark(projectId: string, contents: string): Promise<void> {
  if (!isTauri()) return;
  await ensureClipperProjectDataDir(projectId);
  await invoke("write_clipper_project_data_file", {
    projectId,
    fileName: CLIPPER_FACE_ACTION_BENCHMARK_FILE,
    contents,
  });
  const filePath = await invoke<string>("get_clipper_project_data_file_path", {
    projectId,
    fileName: CLIPPER_FACE_ACTION_BENCHMARK_FILE,
  });
  clipperLog("face-action benchmark written", { projectId, filePath });
}

export async function writeClipperSmartCropAnalysis(projectId: string, blob: ClipperFrameAnalysis): Promise<void> {
  if (!isTauri()) return;
  await ensureClipperProjectDataDir(projectId);
  await invoke("write_clipper_project_data_file", {
    projectId,
    fileName: CLIPPER_SMART_CROP_FILE,
    contents: JSON.stringify(blob),
  });
}

export async function readClipperSmartCropAnalysis(projectId: string): Promise<ClipperFrameAnalysis | null> {
  if (!isTauri()) return null;
  try {
    const contents = await invoke<string>("read_clipper_project_data_file", {
      projectId,
      fileName: CLIPPER_SMART_CROP_FILE,
    });
    await yieldToMain();
    const restored = parseRestoredSmartCropBlob(JSON.parse(contents));
    if (!restored) return null;
    // Keep old project files untouched, but release their large diagnostic
    // object before entering preview playback.
    return isClipperRuntimeSmartCropBlob(restored)
      ? restored
      : compactSmartCropForRuntime(restored as ClipperSmartCropBlob);
  } catch {
    return null;
  }
}

export async function openClipperProjectsDir(): Promise<string> {
  if (!isTauri()) {
    throw new Error("Clipper project data is only available in the desktop app.");
  }
  return invoke<string>("open_clipper_projects_dir");
}

export async function ensureClipperProjectDataDir(projectId: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("Clipper project data is only available in the desktop app.");
  }
  return invoke<string>("ensure_clipper_project_data_dir", { projectId });
}

export async function removeClipperProjectDataDir(projectId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("remove_clipper_project_data_dir", { projectId });
}

export async function writeClipperFaceDetections(
  projectId: string,
  blob: ClipperFaceSamplesBlob,
): Promise<void> {
  if (!isTauri()) return;
  const sampleCount = blob.samples.length;
  const stringifyStart = performance.now();
  const contents = JSON.stringify(blob);
  const stringifyMs = Math.round(performance.now() - stringifyStart);
  const jsonBytes = new TextEncoder().encode(contents).length;

  await ensureClipperProjectDataDir(projectId);
  const invokeStart = performance.now();
  await invoke("write_clipper_project_data_file", {
    projectId,
    fileName: CLIPPER_FACE_DETECTIONS_FILE,
    contents,
  });
  const invokeMs = Math.round(performance.now() - invokeStart);

  clipperLog("post-face: write face blob", {
    sampleCount,
    stringifyMs,
    invokeMs,
    jsonBytes: formatBytes(jsonBytes),
  });
}

export async function readClipperFaceDetections(
  projectId: string,
  runId?: string,
): Promise<ClipperFaceSamplesBlob | null> {
  if (!isTauri()) return null;
  try {
    const contents = await invoke<string>("read_clipper_project_data_file", {
      projectId,
      fileName: CLIPPER_FACE_DETECTIONS_FILE,
    });
    await yieldToMain();
    const parseStep = runId ? `pipeline[${runId}]: resume face-parse` : "resume face-parse";
    return clipperMeasureSync(
      parseStep,
      () => JSON.parse(contents) as ClipperFaceSamplesBlob,
      (blob) => ({ sampleCount: blob.samples.length }),
    );
  } catch {
    return null;
  }
}

function trimRangeMatches(
  metadata: ClipperTrimMetadata,
  clipStart: number,
  clipEnd: number,
): boolean {
  return (
    Math.abs(metadata.clipStart - clipStart) < 0.05 &&
    Math.abs(metadata.clipEnd - clipEnd) < 0.05
  );
}

export async function extractClipperSegmentToProjectData(
  projectId: string,
  sourcePath: string,
  clipStart: number,
  clipEnd: number,
): Promise<ClipperRestoredTrimmedSegment> {
  if (!isTauri()) {
    throw new Error("Native segment extraction requires the desktop app.");
  }
  const filePath = await invoke<string>("extract_clipper_segment_to_project_data", {
    projectId,
    filePath: sourcePath,
    startTime: clipStart,
    endTime: clipEnd,
  });
  const file = pathBackedClipperFile(filePath);
  const videoUrl = await resolveFilePlayableUrl(file);
  return { file, videoUrl };
}

export async function writeClipperTrimmedSegment(
  projectId: string,
  buffer: ArrayBuffer,
  metadata: ClipperTrimMetadata,
): Promise<ClipperRestoredTrimmedSegment | null> {
  if (!isTauri()) return null;
  await ensureClipperProjectDataDir(projectId);
  await invoke("write_clipper_project_data_raw", new Uint8Array(buffer), {
    headers: {
      "x-clipper-project-id": projectId,
      "x-clipper-file-name": CLIPPER_TRIMMED_SEGMENT_FILE,
    },
  });
  await invoke("write_clipper_project_data_file", {
    projectId,
    fileName: CLIPPER_TRIM_METADATA_FILE,
    contents: JSON.stringify(metadata),
  });
  const filePath = await invoke<string>("get_clipper_project_data_file_path", {
    projectId,
    fileName: CLIPPER_TRIMMED_SEGMENT_FILE,
  });
  const file = pathBackedClipperFile(filePath);
  const videoUrl = await resolveFilePlayableUrl(file);
  return { file, videoUrl };
}

export async function readClipperTrimmedSegment(
  projectId: string,
  clipStart: number,
  clipEnd: number,
): Promise<ClipperRestoredTrimmedSegment | null> {
  if (!isTauri()) return null;
  try {
    const metadataContents = await invoke<string>("read_clipper_project_data_file", {
      projectId,
      fileName: CLIPPER_TRIM_METADATA_FILE,
    });
    await yieldToMain();
    const metadata = parseClipperTrimMetadata(JSON.parse(metadataContents));
    if (!metadata || !trimRangeMatches(metadata, clipStart, clipEnd)) {
      return null;
    }

    const filePath = await invoke<string>("get_clipper_project_data_file_path", {
      projectId,
      fileName: CLIPPER_TRIMMED_SEGMENT_FILE,
    });
    const file = pathBackedClipperFile(filePath);
    const videoUrl = await resolveFilePlayableUrl(file);
    return { file, videoUrl };
  } catch {
    return null;
  }
}
