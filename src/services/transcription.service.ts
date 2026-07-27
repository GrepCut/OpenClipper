import {
  localRecordGet,
  localRecordPut,
} from "../shared/persistence/local-database.util";
export * from "./types/transcription.types";
import type {
  ParakeetCapability,
  ParakeetModelStatus,
  ParakeetTranscriptionProgress,
  ParakeetTranscriptionResult,
  Transcription,
} from "./types/transcription.types";
import { debugLogger } from "../shared/utils/noop-logger.util";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../shared/utils/platform.util";
import { ensureClipperProjectDataDir } from "../features/clipper/persistence/project-data-files.util";
import {
  createTauriNativeJobId,
  runTauriNativeJob,
} from "../shared/utils/tauri-native-jobs.util";

const NAMESPACE = "transcription";
const TRANSCRIBE_AUDIO_WAV = "transcribe-audio.wav";

const exactKey = (mediaFileId: string, cacheKey: string) =>
  `${mediaFileId}:${cacheKey}`;
const latestKey = (mediaFileId: string) => `${mediaFileId}:latest`;
const rangeCacheKey = (
  start?: number,
  end?: number,
) =>
  start == null || end == null
    ? "full:parakeet_local"
    : `${start.toFixed(3)}-${end.toFixed(3)}:parakeet_local`;

async function cacheTranscription(
  projectId: string,
  mediaFileId: string,
  cacheKey: string,
  transcription: Transcription,
): Promise<Transcription> {
  await Promise.all([
    localRecordPut(
      NAMESPACE,
      exactKey(mediaFileId, cacheKey),
      projectId,
      transcription,
    ),
    localRecordPut(NAMESPACE, latestKey(mediaFileId), projectId, transcription),
  ]);
  return transcription;
}

function mapParakeetResultToTranscription(
  result: ParakeetTranscriptionResult,
  mediaFileId: string,
): Transcription {
  return {
    id: crypto.randomUUID(),
    mediaFileId,
    engine: "parakeet_local",
    segments: result.segments,
    words: result.words,
  };
}

async function prepareWavPathForParakeet(
  wavBytes: Uint8Array,
  projectId: string,
): Promise<string> {
  await ensureClipperProjectDataDir(projectId);
  await invoke("write_clipper_project_data_raw", wavBytes, {
    headers: {
      "x-clipper-project-id": projectId,
      "x-clipper-file-name": TRANSCRIBE_AUDIO_WAV,
    },
  });
  return invoke<string>("get_clipper_project_data_file_path", {
    projectId,
    fileName: TRANSCRIBE_AUDIO_WAV,
  });
}

export const transcriptionService = {
  transcribe: async (
    wavBytes: Uint8Array,
    mediaFileId: string,
    projectId: string,
    options?: {
      signal?: AbortSignal;
      clipStartSec?: number;
      clipEndSec?: number;
      onParakeetProgress?: (progress: ParakeetTranscriptionProgress) => void;
    },
  ): Promise<Transcription> => {
    const cacheKey = rangeCacheKey(options?.clipStartSec, options?.clipEndSec);
    const cached = await localRecordGet<Transcription>(
      NAMESPACE,
      exactKey(mediaFileId, cacheKey),
    );
    if (cached) return cached;

    const startTime = Date.now();
    debugLogger.log("transcription", "transcription started", {
      mediaFileId,
      projectId,
      cacheKey,
      engine: "parakeet_local",
      wavBytes: wavBytes.byteLength,
    });

    try {
      if (!isTauri()) {
        throw new Error("Lokalna transkrypcja wymaga aplikacji desktopowej.");
      }
      if (!wavBytes.byteLength) {
        throw new Error(
          "Local transcription audio is unavailable. Try selecting the clip range again.",
        );
      }
      const audioPath = await prepareWavPathForParakeet(wavBytes, projectId);
      if (options?.signal?.aborted) {
        throw new DOMException("Conversion aborted", "AbortError");
      }
      const result = await runTauriNativeJob<
        ParakeetTranscriptionProgress,
        ParakeetTranscriptionResult
      >({
        jobId: createTauriNativeJobId("parakeet"),
        startCommand: "start_parakeet_transcription",
        args: { request: { audioPath, language: "pl" } },
        signal: options?.signal,
        onProgress: (progress) => options?.onParakeetProgress?.(progress),
      });
      const transcription = mapParakeetResultToTranscription(result, mediaFileId);
      debugLogger.log("transcription", "parakeet transcription success", {
        mediaFileId,
        durationMs: Date.now() - startTime,
        provider: result.provider,
        inferenceMs: result.processingTimeMs,
      });
      return cacheTranscription(
        projectId,
        mediaFileId,
        cacheKey,
        transcription,
      );
    } catch (error: unknown) {
      debugLogger.log("transcription", "transcription failed", {
        mediaFileId,
        engine: "parakeet_local",
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  getTranscription: async (
    mediaFileId: string,
    options?: {
      clipStartSec?: number;
      clipEndSec?: number;
    },
  ): Promise<Transcription> => {
    const key = options
      ? exactKey(
          mediaFileId,
          rangeCacheKey(options.clipStartSec, options.clipEndSec),
        )
      : latestKey(mediaFileId);
    const transcription = await localRecordGet<Transcription>(NAMESPACE, key);
    if (!transcription)
      throw new Error(`No local transcription for media ${mediaFileId}.`);
    return transcription;
  },

  getParakeetModelStatus: async (): Promise<ParakeetModelStatus> => {
    if (!isTauri()) {
      return {
        installed: false,
        loaded: false,
        path: null,
        provider: null,
        source: null,
        manifestValid: null,
      };
    }
    return invoke<ParakeetModelStatus>("get_parakeet_model_status");
  },

  downloadParakeetModel: async (): Promise<void> => {
    if (!isTauri()) {
      throw new Error("Pobieranie modelu wymaga aplikacji desktopowej.");
    }
    await invoke("download_parakeet_model");
  },

  deleteParakeetModel: async (): Promise<void> => {
    if (!isTauri()) {
      throw new Error("Usuwanie modelu wymaga aplikacji desktopowej.");
    }
    await invoke("delete_parakeet_model");
  },

  probeParakeet: async (): Promise<ParakeetCapability> => {
    if (!isTauri()) {
      return {
        available: false,
        modelInstalled: false,
        reason: "Lokalna transkrypcja wymaga aplikacji desktopowej.",
      };
    }
    return invoke<ParakeetCapability>("probe_parakeet_transcription");
  },

  saveFrontendTranscription: async (payload: {
    mediaFileId: string;
    projectId: string;
    language?: string;
    segments: Transcription["segments"];
    words?: Transcription["words"];
  }): Promise<Transcription> => {
    const transcription: Transcription = {
      id: crypto.randomUUID(),
      mediaFileId: payload.mediaFileId,
      language: payload.language,
      engine: "parakeet_local",
      segments: payload.segments,
      words: payload.words,
    };
    return cacheTranscription(
      payload.projectId,
      payload.mediaFileId,
      "full:parakeet_local",
      transcription,
    );
  },
};
