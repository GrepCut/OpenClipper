import { invoke } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import { ensureClipperProjectDataDir } from "./project-data-files.util";
import { createTauriRawPositionalWritable } from "./tauri-raw-write.util";

export const CLIPPER_TRANSCRIBE_AUDIO_WAV = "transcribe-audio.wav";

export async function getClipperProjectDataFilePath(
  projectId: string,
  fileName: string,
): Promise<string> {
  return invoke<string>("get_clipper_project_data_file_path", {
    projectId,
    fileName,
  });
}

/** Streams mediabunny output directly into the clipper project data directory. */
export async function createClipperTranscriptionAudioSink(projectId: string): Promise<{
  writable: WritableStream<StreamTargetChunk>;
  finalize: () => Promise<string>;
}> {
  await ensureClipperProjectDataDir(projectId);
  return {
    writable: createTauriRawPositionalWritable(
      "write_clipper_project_data_bytes_at",
      projectId,
      CLIPPER_TRANSCRIBE_AUDIO_WAV,
    ),
    async finalize() {
      return getClipperProjectDataFilePath(projectId, CLIPPER_TRANSCRIBE_AUDIO_WAV);
    },
  };
}
