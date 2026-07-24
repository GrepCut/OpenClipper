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
  engine?: "parakeet_local";
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

export interface ParakeetCapability {
  available: boolean;
  provider?: string | null;
  modelInstalled: boolean;
  reason?: string | null;
}

export interface ParakeetTranscriptionProgress {
  phase: string;
  chunkIndex: number;
  chunkCount: number;
  ratio: number;
}

export interface ParakeetTranscriptionResult {
  text: string;
  durationMs: number;
  processingTimeMs: number;
  engine: string;
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
}
