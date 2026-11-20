import { invoke } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import { ensureClipperProjectDataDir } from "./project-data-files.util";
import { createTauriRawPositionalWritable } from "./tauri-raw-write.util";

export async function getClipperProjectDataFilePath(
  projectId: string,
  fileName: string,
): Promise<string> {
  return invoke<string>("get_clipper_project_data_file_path", {
    projectId,
    fileName,
  });
}

/**
 * Streams mediabunny output directly into the clipper project data directory.
 * Each extraction gets a unique file name: a previous run's WAV may still be held with a
 * deny-write lock by another process (antivirus, media player), which would fail every chunk write.
 */
export async function createClipperTranscriptionAudioSink(projectId: string): Promise<{
  writable: WritableStream<StreamTargetChunk>;
  finalize: () => Promise<string>;
}> {
  await ensureClipperProjectDataDir(projectId);
  const fileName = `transcribe-audio-${crypto.randomUUID()}.wav`;
  return {
    writable: createTauriRawPositionalWritable(
      "write_clipper_project_data_bytes_at",
      projectId,
      fileName,
    ),
    async finalize() {
      const path = await getClipperProjectDataFilePath(projectId, fileName);
      void invoke("remove_stale_clipper_transcription_audio", {
        projectId,
        keepFileName: fileName,
      }).catch(() => {});
      return path;
    },
  };
}
