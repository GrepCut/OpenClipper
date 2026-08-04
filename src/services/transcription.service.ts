import {
  localRecordGet,
  localRecordPut,
} from "../shared/persistence/local-database.util";
export * from "./types/transcription.types";
import type {
  ParakeetCapability,
  ParakeetModelStatus,
  WhisperModelStatus,
  VocalsIsolateModelStatus,
  LocalTranscriptionProgress,
  ParakeetTranscriptionResult,
  Transcription,
} from "./types/transcription.types";
import { debugLogger } from "../shared/utils/noop-logger.util";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../shared/utils/platform.util";
import {
  createTauriNativeJobId,
  runTauriNativeJob,
} from "../shared/utils/tauri-native-jobs.util";
import { transcriptionApiKeysService } from "./transcription-api-keys.service";
import {
  GROQ_WHISPER_MODEL,
  OPENROUTER_WHISPER_MODEL,
  transcribeCloudAudioChunks,
} from "./cloud-transcription.service";
import { prepareCloudAudioChunks } from "./cloud-transcribe-audio.util";
import type { ClipperTranscriptionEngine } from "../features/clipper/settings/settings.util";

const NAMESPACE = "transcription";

const exactKey = (mediaFileId: string, cacheKey: string) =>
  `${mediaFileId}:${cacheKey}`;
const latestKey = (mediaFileId: string) => `${mediaFileId}:latest`;

export type LocalTranscriptionEngine = ClipperTranscriptionEngine;

export function isCloudTranscriptionEngine(
  engine: LocalTranscriptionEngine,
): engine is "groq" | "openrouter" {
  return engine === "groq" || engine === "openrouter";
}

const engineId = (engine: LocalTranscriptionEngine) => {
  if (engine === "whisper") return "whisper_local";
  if (engine === "groq") return "groq";
  if (engine === "openrouter") return "openrouter";
  return "parakeet_local";
};

// Prevent old single-pass Whisper results from being restored after the
// chunked decoder is shipped.
const engineCacheId = (
  engine: LocalTranscriptionEngine,
  isolateVocals = false,
) => {
  if (engine === "groq") {
    const base = `${engineId(engine)}:${GROQ_WHISPER_MODEL}`;
    return isolateVocals ? `${base}:vocals-v2` : base;
  }
  if (engine === "openrouter") {
    const base = `${engineId(engine)}:${OPENROUTER_WHISPER_MODEL}`;
    return isolateVocals ? `${base}:vocals-v2` : base;
  }
  const base =
    engine === "whisper" ? `${engineId(engine)}:chunked-v5` : engineId(engine);
  return isolateVocals ? `${base}:vocals-v2` : base;
};

const rangeCacheKey = (
  start?: number,
  end?: number,
  engine: LocalTranscriptionEngine = "parakeet",
  isolateVocals = false,
) =>
  start == null || end == null
    ? `full:${engineCacheId(engine, isolateVocals)}`
    : `${start.toFixed(3)}-${end.toFixed(3)}:${engineCacheId(engine, isolateVocals)}`;

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
  engine: LocalTranscriptionEngine = "parakeet",
): Transcription {
  return {
    id: crypto.randomUUID(),
    mediaFileId,
    engine: engineId(engine),
    segments: result.segments,
    words: result.words,
  };
}

interface PrepareTranscriptionAudioResult {
  audioPath: string;
}

async function prepareAudioForCloud(
  audioPath: string,
  options?: {
    signal?: AbortSignal;
    isolateVocals?: boolean;
    onProgress?: (progress: LocalTranscriptionProgress) => void;
  },
): Promise<string> {
  if (options?.signal?.aborted) {
    throw new DOMException("Conversion aborted", "AbortError");
  }
  if (!options?.isolateVocals) {
    return audioPath;
  }
  const prepared = await runTauriNativeJob<
    LocalTranscriptionProgress,
    PrepareTranscriptionAudioResult
  >({
    jobId: createTauriNativeJobId("prepare-audio"),
    startCommand: "start_prepare_transcription_audio",
    args: {
      request: {
        audioPath,
        isolateVocals: true,
      },
    },
    signal: options?.signal,
    onProgress: (progress) => options?.onProgress?.(progress),
  });
  return prepared.audioPath;
}

export const transcriptionService = {
  transcribe: async (
    audioPath: string,
    mediaFileId: string,
    projectId: string,
    options?: {
      signal?: AbortSignal;
      clipStartSec?: number;
      clipEndSec?: number;
      engine?: LocalTranscriptionEngine;
      language?: string;
      isolateVocals?: boolean;
      onProgress?: (progress: LocalTranscriptionProgress) => void;
    },
  ): Promise<Transcription> => {
    const engine = options?.engine ?? "parakeet";
    const isolateVocals = Boolean(options?.isolateVocals);
    const cacheKey = rangeCacheKey(
      options?.clipStartSec,
      options?.clipEndSec,
      engine,
      isolateVocals,
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
      engine: engineId(engine),
      audioPath,
    });
    try {
      if (!isTauri()) {
        throw new Error("Lokalna transkrypcja wymaga aplikacji desktopowej.");
      }
      if (!audioPath) {
        throw new Error(
          "Local transcription audio is unavailable. Try selecting the clip range again.",
        );
      }

      if (isCloudTranscriptionEngine(engine)) {
        const apiKey = await transcriptionApiKeysService.get(engine);
        if (!apiKey) {
          throw new Error(
            `Configure your ${engine === "groq" ? "Groq" : "OpenRouter"} API key in Settings before transcribing.`,
          );
        }
        const clipDurationSec =
          options?.clipEndSec != null && options?.clipStartSec != null
            ? options.clipEndSec - options.clipStartSec
            : null;
        const preparedAudioPath = await prepareAudioForCloud(audioPath, {
          signal: options?.signal,
          isolateVocals,
          onProgress: options?.onProgress,
        });
        if (options?.signal?.aborted) {
          throw new DOMException("Conversion aborted", "AbortError");
        }
        if (clipDurationSec == null || clipDurationSec <= 0) {
          throw new Error("Cloud transcription requires a valid clip duration.");
        }
        options?.onProgress?.({
          phase: "compressing_audio",
          chunkIndex: 0,
          chunkCount: 0,
          ratio: 0,
          provider: engine,
        });
        const cloudChunks = await prepareCloudAudioChunks(
          preparedAudioPath,
          clipDurationSec,
          {
            signal: options?.signal,
            onProgress: (ratio, chunkIndex, chunkCount) => {
              options?.onProgress?.({
                phase: "compressing_audio",
                chunkIndex,
                chunkCount,
                ratio,
                provider: engine,
              });
            },
          },
        );
        const transcription = await transcribeCloudAudioChunks(
          engine,
          apiKey,
          cloudChunks,
          mediaFileId,
          {
            signal: options?.signal,
            onProgress: (phase, ratio, chunkIndex, chunkCount) => {
              options?.onProgress?.({
                phase,
                chunkIndex,
                chunkCount,
                ratio,
                provider: engine,
              });
            },
          },
        );
        debugLogger.log("transcription", `${engine} cloud transcription success`, {
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

      if (options?.signal?.aborted) {
        throw new DOMException("Conversion aborted", "AbortError");
      }
      const requestLanguage = options?.language ?? (engine === "whisper" ? undefined : "pl");
      const result = await runTauriNativeJob<
        LocalTranscriptionProgress,
        ParakeetTranscriptionResult
      >({
        jobId: createTauriNativeJobId(engine),
        startCommand:
          engine === "whisper"
            ? "start_whisper_transcription"
            : "start_parakeet_transcription",
        args: {
          request: {
            audioPath,
            language: requestLanguage,
            isolateVocals,
          },
        },
        signal: options?.signal,
        onProgress: (progress) => options?.onProgress?.(progress),
      });
      const transcription = mapParakeetResultToTranscription(
        result,
        mediaFileId,
        engine,
      );
      debugLogger.log("transcription", `${engine} transcription success`, {
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
        engine: engineId(engine),
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
      engine?: LocalTranscriptionEngine;
      isolateVocals?: boolean;
    },
  ): Promise<Transcription> => {
    const key = options
      ? exactKey(
          mediaFileId,
          rangeCacheKey(
            options.clipStartSec,
            options.clipEndSec,
            options.engine,
            Boolean(options.isolateVocals),
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

  getWhisperModelStatus: async (): Promise<WhisperModelStatus> => {
    if (!isTauri()) {
      return { installed: false, loaded: false, path: null, provider: null };
    }
    return invoke<WhisperModelStatus>("get_whisper_model_status");
  },

  downloadWhisperModel: async (): Promise<void> => {
    if (!isTauri()) {
      throw new Error("Pobieranie modelu wymaga aplikacji desktopowej.");
    }
    await invoke("download_whisper_model");
  },

  deleteWhisperModel: async (): Promise<void> => {
    if (!isTauri()) {
      throw new Error("Usuwanie modelu wymaga aplikacji desktopowej.");
    }
    await invoke("delete_whisper_model");
  },

  getVocalsIsolateModelStatus: async (): Promise<VocalsIsolateModelStatus> => {
    if (!isTauri()) {
      return { installed: false, path: null, provider: null };
    }
    return invoke<VocalsIsolateModelStatus>("get_vocals_isolate_model_status");
  },

  downloadVocalsIsolateModel: async (): Promise<void> => {
    if (!isTauri()) {
      throw new Error("Pobieranie modelu wymaga aplikacji desktopowej.");
    }
    await invoke("download_vocals_isolate_model");
  },

  deleteVocalsIsolateModel: async (): Promise<void> => {
    if (!isTauri()) {
      throw new Error("Usuwanie modelu wymaga aplikacji desktopowej.");
    }
    await invoke("delete_vocals_isolate_model");
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
