import { apiClient } from "../shared/utils/api-client.util";
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
  TranscriptionEngine,
} from "./types/transcription.types";
import { debugLogger } from "../shared/utils/noop-logger.util";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../shared/utils/platform.util";
import { encodeMono16kWav } from "../features/clipper/lib/media/write-mono16k-wav.util";
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
  engine: TranscriptionEngine = "api",
) =>
  start == null || end == null
    ? `full:${engine}`
    : `${start.toFixed(3)}-${end.toFixed(3)}:${engine}`;

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
  pcm16k: Float32Array,
  projectId: string,
): Promise<string> {
  const wavBytes = encodeMono16kWav(pcm16k);
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
    file: File,
    mediaFileId: string,
    projectId: string,
    options?: {
      signal?: AbortSignal;
      summarize?: boolean;
      audioDurationSeconds?: number;
      clipStartSec?: number;
      clipEndSec?: number;
      sourceFingerprint?: string;
      engine?: TranscriptionEngine;
      /** Mono 16 kHz PCM used by local Parakeet without a browser decode round trip. */
      pcm16k?: Float32Array;
      onParakeetProgress?: (progress: ParakeetTranscriptionProgress) => void;
    },
  ): Promise<Transcription> => {
    const engine = options?.engine ?? "api";
    const cacheKey = rangeCacheKey(
      options?.clipStartSec,
      options?.clipEndSec,
      engine,
    );
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
      engine,
      fileSize: file.size,
    });

    try {
      if (engine === "parakeet_local") {
        if (!isTauri()) {
          throw new Error("Lokalna transkrypcja wymaga aplikacji desktopowej.");
        }
        if (!options?.pcm16k?.length) {
          throw new Error(
            "Local transcription audio is unavailable. Try selecting the clip range again.",
          );
        }
        const audioPath = await prepareWavPathForParakeet(
          options.pcm16k,
          projectId,
        );
        if (options?.signal?.aborted) {
          throw new DOMException("Conversion aborted", "AbortError");
        }
        const result = await runTauriNativeJob<
          ParakeetTranscriptionProgress,
          ParakeetTranscriptionResult
        >({
          jobId: createTauriNativeJobId("parakeet"),
          startCommand: "start_parakeet_transcription",
          args: {
            request: { audioPath, language: "pl" },
          },
          signal: options?.signal,
          onProgress: (progress) => options?.onParakeetProgress?.(progress),
        });
        const transcription = mapParakeetResultToTranscription(
          result,
          mediaFileId,
        );
        debugLogger.log("transcription", "parakeet transcription success", {
          mediaFileId,
          durationMs: Date.now() - startTime,
        });
        return cacheTranscription(
          projectId,
          mediaFileId,
          cacheKey,
          transcription,
        );
      }

      const formData = new FormData();
      formData.append("clientMediaId", mediaFileId);
      formData.append("clientProjectId", projectId);
      formData.append("cacheKey", cacheKey);
      formData.append(
        "sourceFingerprint",
        options?.sourceFingerprint ??
          `${file.name}:${file.size}:${file.lastModified}`,
      );
      formData.append("sourceName", file.name);
      formData.append("sourceSizeBytes", String(file.size));
      formData.append("summarize", options?.summarize ? "true" : "false");
      if (options?.audioDurationSeconds != null) {
        formData.append(
          "audioDurationSeconds",
          String(options.audioDurationSeconds),
        );
      }
      if (options?.clipStartSec != null)
        formData.append("clipStartSec", String(options.clipStartSec));
      if (options?.clipEndSec != null)
        formData.append("clipEndSec", String(options.clipEndSec));
      formData.append("file", file);

      const response = await apiClient.post<Transcription>(
        "/transcription/clipper",
        formData,
        {
          timeout: 1_800_000,
          signal: options?.signal,
        },
      );
      const transcription: Transcription = {
        ...response.data,
        engine: "api",
      };
      debugLogger.log("transcription", "api transcription success", {
        mediaFileId,
        durationMs: Date.now() - startTime,
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
        engine,
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
      engine?: TranscriptionEngine;
    },
  ): Promise<Transcription> => {
    const key = options
      ? exactKey(
          mediaFileId,
          rangeCacheKey(
            options.clipStartSec,
            options.clipEndSec,
            options.engine,
          ),
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

  loadParakeetModel: async (): Promise<void> => {
    if (!isTauri()) return;
    await invoke("load_parakeet_model");
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
    engine?: TranscriptionEngine;
    segments: Transcription["segments"];
    words?: Transcription["words"];
  }): Promise<Transcription> => {
    const transcription: Transcription = {
      id: crypto.randomUUID(),
      mediaFileId: payload.mediaFileId,
      language: payload.language,
      engine: payload.engine,
      segments: payload.segments,
      words: payload.words,
    };
    return cacheTranscription(
      payload.projectId,
      payload.mediaFileId,
      `full:${payload.engine ?? "api"}`,
      transcription,
    );
  },
};
