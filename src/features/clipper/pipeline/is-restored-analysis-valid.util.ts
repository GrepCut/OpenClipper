const CLIP_RANGE_TOLERANCE_SEC = 0.05;

export interface RestoredClipAnalysisBlob {
  clipStart: number;
  clipEnd: number;
  samples: unknown[];
}

export interface RestoredSmartCropAnalysisBlob {
  clipStart: number;
  clipEnd: number;
  cameraSmoothing?: "smooth" | "balanced" | "snappy";
  aspectTracks?: Record<string, { samples: unknown[] }>;
}

export function isRestoredClipAnalysisValid(
  blob: RestoredClipAnalysisBlob | null | undefined,
  options: {
    start: number;
    end: number;
    version: string;
    blobVersion: string | undefined;
    minSamples?: number;
  },
): boolean {
  if (!blob || options.blobVersion !== options.version) {
    return false;
  }

  const minSamples = options.minSamples ?? 1;
  if (blob.samples.length < minSamples) {
    return false;
  }

  return (
    Math.abs(blob.clipStart - options.start) < CLIP_RANGE_TOLERANCE_SEC &&
    Math.abs(blob.clipEnd - options.end) < CLIP_RANGE_TOLERANCE_SEC
  );
}

export function isRestoredSmartCropAnalysisValid(
  blob: RestoredSmartCropAnalysisBlob | null | undefined,
  options: {
    start: number;
    end: number;
    version: string;
    blobVersion: string | undefined;
    minSamples?: number;
    smoothing?: "smooth" | "balanced" | "snappy";
  },
): boolean {
  if (!blob || options.blobVersion !== options.version) {
    return false;
  }
  if (options.smoothing != null && blob.cameraSmoothing !== options.smoothing) return false;

  const minSamples = options.minSamples ?? 1;
  const trackSamples = Object.values(blob.aspectTracks ?? {}).map((track) => track.samples.length);
  if (!trackSamples.some((count) => count >= minSamples)) {
    return false;
  }

  return (
    Math.abs(blob.clipStart - options.start) < CLIP_RANGE_TOLERANCE_SEC &&
    Math.abs(blob.clipEnd - options.end) < CLIP_RANGE_TOLERANCE_SEC
  );
}
