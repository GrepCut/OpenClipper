export interface SegmentProgressInfo {
  index: number;
  startTime: number;
  endTime: number;
  ratio: number;
  status: "pending" | "running" | "done" | "error";
}

export interface ConverterProgress {
  ratio: number | null;
  stage: string;
  segments?: readonly SegmentProgressInfo[];
}

export interface ConvertOptions {
  presetId?: string;
  settings?: Readonly<Record<string, string>>;
  inputFiles?: readonly File[];
  signal?: AbortSignal;
  onProgress?: (progress: ConverterProgress) => void;
  outputFileHandle?: FileSystemFileHandle;
}

export type ConversionOutput =
  | { kind: "memory"; blob: Blob }
  | { kind: "file"; size: number };
