/**
 * Limits concurrent video encode submissions to bound memory usage.
 * Mirrors `GPU_BATCH_SIZE` from the export renderer's frame-encoder module.
 */
export const ENCODE_BATCH_SIZE = 8;

export class EncodeBackpressure {
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxInFlight = ENCODE_BATCH_SIZE) {}

  async acquire(): Promise<void> {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.inFlight++;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
