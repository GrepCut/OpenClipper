import { invoke } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import { clipperLog } from "../shared/logger.util";

type RawPositionalWriteCommand =
  | "write_clipper_export_file_bytes_at"
  | "write_clipper_project_data_bytes_at";

/**
 * Streams mediabunny output chunks to a Tauri positional-write command as a raw IPC body.
 * Passing bytes inside an args object makes Tauri JSON-encode them as a number array
 * (~2.7 s of main-thread JS per 16 MiB chunk), which stalls a render running on the same thread.
 */
export function createTauriRawPositionalWritable(
  command: RawPositionalWriteCommand,
  projectId: string,
  fileName: string,
): WritableStream<StreamTargetChunk> {
  let writeMs = 0;
  let bytes = 0;
  return new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      if (chunk.data.length === 0) return;
      const startedAt = performance.now();
      await invoke(command, chunk.data, {
        headers: {
          "x-clipper-project-id": encodeURIComponent(projectId),
          "x-clipper-file-name": encodeURIComponent(fileName),
          "x-clipper-position": String(chunk.position),
        },
      });
      writeMs += performance.now() - startedAt;
      bytes += chunk.data.length;
    },
    close() {
      clipperLog(`disk write ${fileName}`, { bytes, writeMs: Math.round(writeMs) });
    },
  });
}
