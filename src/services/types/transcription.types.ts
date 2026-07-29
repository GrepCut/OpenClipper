export interface TranscriptionSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface TranscriptionWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface Transcription {
  id: string;
  mediaFileId: string;
  language?: string;
  engine?: "parakeet_local" | "whisper_local";
  segments: TranscriptionSegment[];
  words?: TranscriptionWord[];
}

export interface ParakeetModelStatus {
  installed: boolean;
  loaded: boolean;
  path?: string | null;
  provider?: string | null;
  source?: string | null;
  manifestValid?: boolean | null;
}

export interface WhisperModelStatus {
  installed: boolean;
  loaded: boolean;
  path?: string | null;
  provider?: string | null;
}

export interface VocalsIsolateModelStatus {
  installed: boolean;
  path?: string | null;
  provider?: string | null;
}

export interface ParakeetCapability {
  available: boolean;
  provider?: string | null;
  modelInstalled: boolean;
  reason?: string | null;
}

export interface LocalTranscriptionProgress {
  phase: string;
  chunkIndex: number;
  chunkCount: number;
  ratio: number;
  provider?: string | null;
}

/** @deprecated Use LocalTranscriptionProgress. */
export type ParakeetTranscriptionProgress = LocalTranscriptionProgress;

export interface ParakeetTranscriptionResult {
  text: string;
  durationMs: number;
  processingTimeMs: number;
  engine: string;
  provider: string;
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
}
