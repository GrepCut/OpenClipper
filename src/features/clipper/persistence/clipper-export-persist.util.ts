import type { ClipperGeneratedClip } from "../engine/segmentation";
import { buildClipExportTranscript } from "./export-transcript.util";
import { upsertClipperExport, type ClipperExportRecord } from "./clipper-export-db-api.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { metadataFieldsFromExportRecord } from "../hooks/clipper-pipeline/export-manifest-resolve.util";
import { assertClipperProjectWritable } from "./project-write-lifecycle.util";

export class ClipperExportRegistrationError extends Error {
  constructor(readonly result: ClipperFormatResult, cause: unknown) {
    super("The video is saved, but its export record could not be saved. Check free disk space and storage access, then retry saving or closing Clipper.", { cause });
    this.name = "ClipperExportRegistrationError";
  }
}

export interface PersistClipperExportDiskMeta {
  id: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  exportedAt: string;
  clipStartSec: number;
  clipEndSec: number;
  renderSignature?: string;
}

type PendingExport = {
  projectId: string;
  payload: PersistClipperExportDiskMeta & { transcriptPlain: string; transcriptTimestamped: string };
  result: ClipperFormatResult;
  inFlight?: Promise<ClipperExportRecord>;
};
const pendingExports = new Map<string, PendingExport>();

function registerPendingExport(id: string, pending: PendingExport): Promise<ClipperExportRecord> {
  if (pending.inFlight) return pending.inFlight;
  assertClipperProjectWritable(pending.projectId);
  const request = upsertClipperExport(pending.projectId, pending.payload).then((record) => {
    if (pendingExports.get(id) === pending) pendingExports.delete(id);
    return record;
  }).catch((error: unknown) => {
    throw new ClipperExportRegistrationError(pending.result, error);
  }).finally(() => { pending.inFlight = undefined; });
  pending.inFlight = request;
  return request;
}

/** Retry registration only; never encode or delete the already completed video. */
export async function flushPendingClipperExports(projectId?: string): Promise<ClipperFormatResult[]> {
  const results = await Promise.allSettled([...pendingExports].filter(([, item]) =>
    !projectId || item.projectId === projectId,
  ).map(async ([id, pending]) => {
    const record = await registerPendingExport(id, pending);
    return { ...pending.result, ...metadataFieldsFromExportRecord(record), registrationPending: false };
  }));
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

export function getPendingClipperExportResults(projectId: string): ClipperFormatResult[] {
  return [...pendingExports.values()].filter((item) => item.projectId === projectId).map((item) => item.result);
}

export async function settlePendingClipperExports(projectId: string): Promise<void> {
  await Promise.allSettled([...pendingExports.values()]
    .filter((item) => item.projectId === projectId && item.inFlight).map((item) => item.inFlight));
}

export function discardPendingClipperExports(projectId: string): void {
  for (const [id, pending] of pendingExports) {
    if (pending.projectId === projectId) pendingExports.delete(id);
  }
}

/** Single write path: upsert clipper_exports with transcript. Backend emits change events. */
export async function persistClipperExport(
  projectId: string,
  clip: ClipperGeneratedClip,
  diskMeta: PersistClipperExportDiskMeta,
  result: ClipperFormatResult,
): Promise<ClipperExportRecord> {
  assertClipperProjectWritable(projectId);
  const { transcriptPlain, transcriptTimestamped } = buildClipExportTranscript(clip);
  const pending: PendingExport = {
    projectId,
    payload: { ...diskMeta, transcriptPlain, transcriptTimestamped },
    result: { ...result, transcriptPlain, transcriptTimestamped, registrationPending: true },
  };
  pendingExports.set(diskMeta.id, pending);
  return registerPendingExport(diskMeta.id, pending);
}
