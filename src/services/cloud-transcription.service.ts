import type {
  Transcription,
  TranscriptionSegment,
  TranscriptionWord,
} from "./types/transcription.types";
import type { CloudTranscriptionProvider } from "./transcription-api-keys.service";
import { logTranscriptionDiag } from "../shared/utils/transcription-diag-log.util";
import type { PreparedCloudAudioChunk } from "./cloud-transcribe-audio.util";

export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";
export const OPENROUTER_WHISPER_MODEL = "openai/whisper-large-v3-turbo";
export const GROQ_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const CLOUD_FETCH_TIMEOUT_MS = 5 * 60 * 1000;

function cloudFetchSignal(userSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS);
  return userSignal ? AbortSignal.any([userSignal, timeoutSignal]) : timeoutSignal;
}

interface CloudWhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface CloudWhisperResponse {
  language?: string;
  text?: string;
  words?: CloudWhisperWord[];
}

const PROVIDER_CONFIG: Record<
  CloudTranscriptionProvider,
  { endpoint: string; model: string; openRouterHeaders?: boolean }
> = {
  groq: {
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: GROQ_WHISPER_MODEL,
  },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1/audio/transcriptions",
    model: OPENROUTER_WHISPER_MODEL,
    openRouterHeaders: true,
  },
};

function assertWordTimestamps(words: CloudWhisperWord[] | undefined): void {
  if (!words?.length) {
    throw new Error("Cloud transcription returned no word timestamps.");
  }
  const hasTimestamps = words.some(
    (word) => Number.isFinite(word.start) && Number.isFinite(word.end),
  );
  if (!hasTimestamps) {
    throw new Error("Cloud transcription returned invalid word timestamps.");
  }
}

export function mapCloudWhisperResponseToTranscription(
  response: CloudWhisperResponse,
  mediaFileId: string,
  engine: CloudTranscriptionProvider,
  timeOffsetSec = 0,
): Transcription {
  assertWordTimestamps(response.words);
  const words: TranscriptionWord[] = (response.words ?? []).map((word) => ({
    text: word.word,
    startTime: word.start + timeOffsetSec,
    endTime: word.end + timeOffsetSec,
  }));
  const segments: TranscriptionSegment[] = words.map((word) => ({
    id: crypto.randomUUID(),
    startTime: word.startTime,
    endTime: word.endTime,
    text: word.text,
  }));
  return {
    id: crypto.randomUUID(),
    mediaFileId,
    language: response.language,
    engine,
    segments,
    words,
  };
}

export function mergeCloudChunkTranscriptions(
  chunks: Transcription[],
): Transcription {
  if (!chunks.length) {
    throw new Error("Cloud transcription returned no chunks.");
  }
  const words = chunks
    .flatMap((chunk) => chunk.words ?? [])
    .sort((left, right) => left.startTime - right.startTime);
  const segments: TranscriptionSegment[] = words.map((word) => ({
    id: crypto.randomUUID(),
    startTime: word.startTime,
    endTime: word.endTime,
    text: word.text,
  }));
  return {
    id: crypto.randomUUID(),
    mediaFileId: chunks[0]!.mediaFileId,
    language: chunks.find((chunk) => chunk.language)?.language,
    engine: chunks[0]!.engine,
    segments,
    words,
  };
}

function buildFormData(
  provider: CloudTranscriptionProvider,
  audioBytes: Uint8Array,
  mimeType: string,
  filename: string,
): FormData {
  const config = PROVIDER_CONFIG[provider];
  const formData = new FormData();
  formData.append("file", new Blob([audioBytes], { type: mimeType }), filename);
  formData.append("model", config.model);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");
  return formData;
}

function formatCloudError(provider: CloudTranscriptionProvider, status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `${provider === "groq" ? "Groq" : "OpenRouter"} rejected the API key. Check Settings.`;
  }
  if (status === 429) {
    return `${provider === "groq" ? "Groq" : "OpenRouter"} rate limit reached. Try again later.`;
  }
  if (status === 413 || body.toLowerCase().includes("file too large")) {
    return "Audio file is too large for cloud transcription (Groq limit: 25 MB).";
  }
  return `${provider === "groq" ? "Groq" : "OpenRouter"} transcription failed (${status}): ${body}`;
}

export async function transcribeWithCloudProvider(
  provider: CloudTranscriptionProvider,
  apiKey: string,
  audioBytes: Uint8Array,
  mediaFileId: string,
  options?: {
    signal?: AbortSignal;
    diagRunId?: string;
    mimeType?: string;
    filename?: string;
    timeOffsetSec?: number;
    onProgress?: (phase: "uploading" | "waiting", ratio: number) => void;
  },
): Promise<Transcription> {
  if (!audioBytes.byteLength) {
    throw new Error("Transcription audio is empty.");
  }
  if (provider === "groq" && audioBytes.byteLength > GROQ_MAX_UPLOAD_BYTES) {
    throw new Error(
      `Audio file is too large for Groq (${Math.ceil(audioBytes.byteLength / (1024 * 1024))} MB). Maximum is 25 MB.`,
    );
  }

  const config = PROVIDER_CONFIG[provider];
  const mimeType = options?.mimeType ?? "audio/mpeg";
  const filename = options?.filename ?? "transcribe-audio.mp3";
  options?.onProgress?.("uploading", 0.1);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (config.openRouterHeaders) {
    headers["HTTP-Referer"] = "https://www.grepcut.com";
    headers["X-Title"] = "Open Clipper";
  }

  options?.onProgress?.("uploading", 0.35);
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: buildFormData(provider, audioBytes, mimeType, filename),
    signal: cloudFetchSignal(options?.signal),
  });

  options?.onProgress?.("waiting", 0.7);
  const body = await response.text();
  if (!response.ok) {
    logTranscriptionDiag("TRANSCRIBE_ERROR", {
      runId: options?.diagRunId,
      step: "cloud_transcribe",
      provider,
      status: response.status,
      error: body.slice(0, 200),
    });
    throw new Error(formatCloudError(provider, response.status, body));
  }

  const payload = JSON.parse(body) as CloudWhisperResponse;
  options?.onProgress?.("waiting", 1);
  return mapCloudWhisperResponseToTranscription(
    payload,
    mediaFileId,
    provider,
    options?.timeOffsetSec ?? 0,
  );
}

export async function transcribeCloudAudioChunks(
  provider: CloudTranscriptionProvider,
  apiKey: string,
  chunks: PreparedCloudAudioChunk[],
  mediaFileId: string,
  options?: {
    signal?: AbortSignal;
    diagRunId?: string;
    onProgress?: (
      phase: "uploading" | "waiting",
      ratio: number,
      chunkIndex: number,
      chunkCount: number,
    ) => void;
  },
): Promise<Transcription> {
  if (!chunks.length) {
    throw new Error("No cloud audio chunks were prepared.");
  }
  const chunkCount = chunks.length;
  const transcriptions: Transcription[] = [];
  for (const chunk of chunks) {
    if (options?.signal?.aborted) {
      throw new DOMException("Conversion aborted", "AbortError");
    }
    const transcription = await transcribeWithCloudProvider(
      provider,
      apiKey,
      chunk.bytes,
      mediaFileId,
      {
        signal: options?.signal,
        diagRunId: options?.diagRunId,
        mimeType: "audio/mpeg",
        filename: `transcribe-audio-${chunk.index + 1}.mp3`,
        timeOffsetSec: chunk.startSec,
        onProgress: (phase, ratio) => {
          const overall =
            (chunk.index + ratio) / chunkCount;
          options?.onProgress?.(phase, overall, chunk.index, chunkCount);
        },
      },
    );
    transcriptions.push(transcription);
  }
  const merged = mergeCloudChunkTranscriptions(transcriptions);
  logTranscriptionDiag("CLOUD_DONE", {
    runId: options?.diagRunId,
    provider,
    wordCount: merged.words?.length ?? 0,
    chunkCount,
  });
  return merged;
}
