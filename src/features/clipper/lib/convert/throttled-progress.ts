import type { ConverterProgress } from "../types/converter.types";

const DEFAULT_INTERVAL_MS = 200;

/** Coalesces chatty encoder updates while preserving stage changes and completion. */
export function createThrottledProgressReporter(
  callback: ((progress: ConverterProgress) => void) | undefined,
  intervalMs = DEFAULT_INTERVAL_MS,
) {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastStage: string | null = null;
  let pending: ConverterProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!pending || !callback) return;
    const progress = pending;
    pending = null;
    lastSentAt = Date.now();
    lastStage = progress.stage;
    callback(progress);
  };

  const report = (progress: ConverterProgress) => {
    if (!callback) return;
    pending = progress;
    const isFinal = progress.ratio === 1;
    const stageChanged = progress.stage !== lastStage;
    const remaining = intervalMs - (Date.now() - lastSentAt);

    if (isFinal || stageChanged || remaining <= 0) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }

    if (!timer) {
      timer = setTimeout(flush, remaining);
    }
  };

  return {
    report,
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
