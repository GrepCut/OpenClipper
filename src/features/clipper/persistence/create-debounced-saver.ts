export interface DebouncedSaver<T> {
  schedule: (payload: T) => void;
  scheduleImmediate: (payload: T) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function createDebouncedSaver<T>(options: {
  debounceMs: number;
  flush: (payload: T) => Promise<void>;
}): DebouncedSaver<T> {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  const cancel = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  const flush = async () => {
    cancel();
    const payload = pending;
    pending = null;
    if (payload == null) return;
    await options.flush(payload);
  };

  const schedule = (payload: T) => {
    pending = payload;
    cancel();
    saveTimer = setTimeout(() => {
      void flush();
    }, options.debounceMs);
  };

  const scheduleImmediate = (payload: T) => {
    pending = payload;
    cancel();
    void flush();
  };

  return { schedule, scheduleImmediate, flush, cancel };
}
