import { invoke } from "@tauri-apps/api/core";
import { pathBackedFile } from "../platform/native-source.util";
import { createTauriRawPositionalWritable } from "./tauri-raw-write.util";
import { ensureClipperProjectDataDir } from "./project-data-files.util";

/** Import browser-backed Files without allocating the entire source/trim in the WebView. */
export async function stageSourceFile(file: File, projectId: string, signal: AbortSignal,
  onProgress?: (ratio: number) => void): Promise<File> {
  signal.throwIfAborted();
  await ensureClipperProjectDataDir(projectId);
  const extension = file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? ".bin";
  const id = crypto.randomUUID();
  const temporaryName = `source-${id}.part${extension}`;
  const fileName = `source-${id}${extension}`;
  const writer = createTauriRawPositionalWritable("write_clipper_project_data_bytes_at", projectId, temporaryName).getWriter();
  try {
    const chunkSize = 1024 * 1024;
    for (let position = 0; position < file.size; position += chunkSize) {
      signal.throwIfAborted();
      const data = new Uint8Array(await file.slice(position, position + chunkSize).arrayBuffer());
      await writer.write({ type: "write", position, data });
      onProgress?.(Math.min(1, (position + data.length) / file.size));
    }
    if (!file.size) throw new Error("Source file is empty. Select the original video again.");
    await writer.close();
    signal.throwIfAborted();
    const filePath = await invoke<string>("finalize_clipper_project_data_file", { projectId, temporaryName, fileName });
    return pathBackedFile(filePath, file.name, file.type);
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await invoke("remove_clipper_project_data_partial", { projectId, fileName: temporaryName }).catch(() => {});
    throw error;
  } finally {
    writer.releaseLock();
  }
}
