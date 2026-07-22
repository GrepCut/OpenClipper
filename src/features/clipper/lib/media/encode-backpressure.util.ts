import pLimit from "p-limit";

/**
 * Limits concurrent video encode submissions to bound memory usage.
 * Mirrors `GPU_BATCH_SIZE` from the export renderer's frame-encoder module.
 */
export const ENCODE_BATCH_SIZE = 8;

export class EncodeBackpressure {
  private readonly limit;

  constructor(maxInFlight = ENCODE_BATCH_SIZE) {
    this.limit = pLimit(maxInFlight);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    return this.limit(task);
  }
}
