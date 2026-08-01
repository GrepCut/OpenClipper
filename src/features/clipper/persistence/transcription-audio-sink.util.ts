import { invoke } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import { ensureClipperProjectDataDir } from "./project-data-files.util";

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

function createTauriProjectDataWritable(
  projectId: string,
  fileName: string,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      const bytes = chunk.data;
      if (bytes.length === 0) return;
      await invoke("write_clipper_project_data_bytes_at", {
        projectId,
        fileName,
        position: chunk.position,
        contents: bytes,
      });
    },
  });
}

/** Streams mediabunny output directly into the clipper project data directory. */
export async function createClipperTranscriptionAudioSink(projectId: string): Promise<{
  writable: WritableStream<StreamTargetChunk>;
  finalize: () => Promise<string>;
}> {
  await ensureClipperProjectDataDir(projectId);
  return {
    writable: createTauriProjectDataWritable(projectId, CLIPPER_TRANSCRIBE_AUDIO_WAV),
    async finalize() {
      return getClipperProjectDataFilePath(projectId, CLIPPER_TRANSCRIBE_AUDIO_WAV);
    },
  };
}
