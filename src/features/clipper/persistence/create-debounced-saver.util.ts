export interface DebouncedSaver<T> {
  schedule: (payload: T) => void;
  scheduleImmediate: (payload: T) => Promise<void>;
  flush: () => Promise<void>;
  cancel: () => void;
  pause: (key: string) => Promise<void>;
  resume: (key: string) => void;
  discard: (key: string) => Promise<void>;
}

export function createDebouncedSaver<T>(options: {
  debounceMs: number;
  flush: (payload: T) => Promise<void>;
  key?: (payload: T) => string;
  onError?: (error: unknown) => void;
}): DebouncedSaver<T> {
  type Entry = {
    pending: T | null;
    timer: ReturnType<typeof setTimeout> | null;
    inFlight: Promise<void> | null;
    paused: boolean;
    version: number;
    savedVersion: number;
    discarded: boolean;
    resumeWait: Promise<void> | null;
    releasePause: (() => void) | null;
  };
  const entries = new Map<string, Entry>();
  const createEntry = (): Entry => ({
    pending: null, timer: null, inFlight: null, paused: false, version: 0, savedVersion: 0,
    discarded: false, resumeWait: null, releasePause: null,
  });
  const cancelTimer = (entry: Entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  };
  const flushEntry = async (key: string, entry: Entry): Promise<void> => {
    cancelTimer(entry);
    const requiredVersion = entry.version;
    try {
      while (entry.savedVersion < requiredVersion) {
        if (entry.discarded) throw new DOMException("Project writes were discarded.", "AbortError");
        if (entry.paused) {
          await entry.resumeWait;
          continue;
        }
        if (entry.inFlight) {
          await entry.inFlight;
          continue;
        }
        const payload = entry.pending;
        if (payload === null) break;
        const version = entry.version;
        entry.pending = null;
        const write = Promise.resolve().then(() => options.flush(payload));
        entry.inFlight = write;
        try {
          await write;
          entry.savedVersion = version;
        } catch (error) {
          entry.pending ??= payload;
          try { options.onError?.(error); } catch { /* Keep the original failure. */ }
          throw error;
        } finally {
          entry.inFlight = null;
        }
      }
    } finally {
      if (!entry.paused && entry.pending === null && !entry.inFlight && entry.timer === null
        && entries.get(key) === entry) entries.delete(key);
    }
  };
  const startTimer = (key: string, entry: Entry) => {
    if (entry.paused) return;
    entry.timer = setTimeout(() => {
      void flushEntry(key, entry).catch(() => {});
    }, options.debounceMs);
  };
  const enqueue = (payload: T) => {
    const key = options.key?.(payload) ?? "default";
    let entry = entries.get(key);
    if (!entry) {
      entry = createEntry();
      entries.set(key, entry);
    }
    entry.pending = payload;
    entry.version++;
    cancelTimer(entry);
    return { key, entry };
  };
  return {
    schedule(payload) {
      const { key, entry } = enqueue(payload);
      startTimer(key, entry);
    },
    scheduleImmediate(payload) {
      const { key, entry } = enqueue(payload);
      const request = flushEntry(key, entry);
      void request.catch(() => {});
      return request;
    },
    async flush() {
      const results = await Promise.allSettled(
        [...entries].filter(([, entry]) => !entry.paused).map(([key, entry]) => flushEntry(key, entry)),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
    cancel() {
      for (const entry of entries.values()) cancelTimer(entry);
    },
    async pause(key) {
      let entry = entries.get(key);
      if (!entry) {
        entry = createEntry();
        entries.set(key, entry);
      }
      if (!entry.paused) {
        entry.resumeWait = new Promise<void>((resolve) => { entry.releasePause = resolve; });
      }
      entry.paused = true;
      cancelTimer(entry);
      await entry.inFlight?.catch(() => {});
    },
    resume(key) {
      const entry = entries.get(key);
      if (!entry) return;
      entry.paused = false;
      entry.releasePause?.();
      entry.releasePause = null;
      entry.resumeWait = null;
      if (entry.pending !== null) startTimer(key, entry);
      else if (!entry.inFlight) entries.delete(key);
    },
    async discard(key) {
      await this.pause(key);
      const entry = entries.get(key);
      if (entry) {
        entry.pending = null;
        entry.discarded = true;
        entry.releasePause?.();
      }
      entries.delete(key);
    },
  };
}
