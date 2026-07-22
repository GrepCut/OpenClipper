import type { ClipperFaceSamplesBlob, FaceBoxSample } from "../../shared/face-samples";

/** Sample every 0.5s to keep whole-clip face analysis fast, while still providing a stable focus track. */
export const FACE_SAMPLE_INTERVAL_SEC = 0.5;

export function hasAnyFaces(samples: FaceBoxSample[]): boolean {
  return samples.some((s) => s.faces.length > 0);
}

/**
 * Bucket key for coalescing preview scrub time and render frame PTS onto one
 * cache slot. A 0.5s bucket coalesces requests around each precomputed sample.
 */
export function faceBucketKey(time: number, intervalSec: number = FACE_SAMPLE_INTERVAL_SEC): number {
  return Math.round(time / intervalSec);
}

/** Per-session cache of face detections prefilled by the WinML analysis pass. */
export class FaceSampleCache {
  private samples = new Map<number, FaceBoxSample>();
  private sortedCache: FaceBoxSample[] | null = null;
  private revision = 0;
  readonly intervalSec: number;
  analysisEngine: "winml" = "winml";
  analysisModelVersion = "winml-clipper-vision";

  constructor(
    intervalSec: number = FACE_SAMPLE_INTERVAL_SEC,
    private onSampleResolved?: () => void,
  ) {
    this.intervalSec = intervalSec;
  }

  hasBucket(time: number): boolean {
    return this.samples.has(faceBucketKey(time, this.intervalSec));
  }

  /** Monotonic counter bumped on ingest — lets callers invalidate derived track caches. */
  get sampleRevision(): number {
    return this.revision;
  }

  /** Ascending by time — cached until the next ingest. */
  sortedSamples(): FaceBoxSample[] {
    if (this.sortedCache) return this.sortedCache;
    this.sortedCache = [...this.samples.values()].sort((a, b) => a.time - b.time);
    return this.sortedCache;
  }

  private invalidateSortedCache(): void {
    this.sortedCache = null;
    this.revision++;
  }

  /** Restores many precomputed samples with a single cache invalidation. */
  bulkIngest(samples: FaceBoxSample[]): void {
    let added = false;
    for (const sample of samples) {
      const key = faceBucketKey(sample.time, this.intervalSec);
      if (this.samples.has(key)) continue;
      this.samples.set(key, sample);
      added = true;
    }
    if (added) {
      this.invalidateSortedCache();
      this.onSampleResolved?.();
    }
  }

  /** Flags the bucket nearest `time` as a hard cut. */
  markSceneCut(time: number): void {
    const key = faceBucketKey(time, this.intervalSec);
    const sample = this.samples.get(key);
    if (!sample) return;
    sample.sceneCut = true;
    this.invalidateSortedCache();
  }
}

export function hydrateFaceSampleCache(
  cache: FaceSampleCache,
  blob: ClipperFaceSamplesBlob,
): void {
  if (blob.engine && blob.engine !== "winml") return;
  cache.analysisEngine = "winml";
  cache.analysisModelVersion = blob.modelVersion ?? "winml-clipper-vision";
  cache.bulkIngest(blob.samples);
}

export function getClipperDetectorVersion(): string {
  return "winml-clipper-vision-v1-policy3";
}

export function serializeFaceSampleCache(
  cache: FaceSampleCache,
  clipStart: number,
  clipEnd: number,
): ClipperFaceSamplesBlob {
  return {
    detectorVersion: getClipperDetectorVersion(),
    engine: cache.analysisEngine,
    modelVersion: cache.analysisModelVersion,
    clipStart,
    clipEnd,
    samples: cache.sortedSamples(),
  };
}
