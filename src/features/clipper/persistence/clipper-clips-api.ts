import {
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database";
import type { ClipSourceMode } from "../shared/state";

export interface ClipperClipSegmentPayload {
  orderIndex: number;
  startSec: number;
  endSec: number;
  wordStartIdx?: number | null;
  wordEndIdx?: number | null;
}

export interface ClipperClipPayload {
  index: number;
  startSec: number;
  endSec: number;
  label?: string;
  segments: ClipperClipSegmentPayload[];
}

const clipKey = (projectId: string, mode: ClipSourceMode) =>
  `${projectId}:${mode}`;

export async function fetchClipperClips(
  projectId: string,
  mode: ClipSourceMode,
): Promise<ClipperClipPayload[]> {
  return (
    (await localRecordGet<ClipperClipPayload[]>(
      "clipper-clips",
      clipKey(projectId, mode),
    )) ?? []
  );
}

export async function saveClipperClips(
  projectId: string,
  mode: ClipSourceMode,
  clips: ClipperClipPayload[],
): Promise<ClipperClipPayload[]> {
  return localRecordPut(
    "clipper-clips",
    clipKey(projectId, mode),
    projectId,
    clips,
  );
}

export async function fetchDisabledCollageRegions(
  projectId: string,
): Promise<string[]> {
  return (
    (await localRecordGet<string[]>("clipper-collage-regions", projectId)) ?? []
  );
}

export async function saveDisabledCollageRegions(
  projectId: string,
  disabledRegionIds: string[],
): Promise<string[]> {
  return localRecordPut(
    "clipper-collage-regions",
    projectId,
    projectId,
    disabledRegionIds,
  );
}
