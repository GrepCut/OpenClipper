const PREFIX = "[Clipper]";

export function clipperLog(step: string, details?: Record<string, unknown>): void {
  void step;
  void details;
}

export function clipperWarn(step: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(`${PREFIX} ${step}`, details);
  } else {
    console.warn(`${PREFIX} ${step}`);
  }
}

export function clipperError(step: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(`${PREFIX} ${step}`, {
    ...details,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

export function clipperTimer(step: string): () => void {
  const start = performance.now();
  clipperLog(`${step} — started`);
  return () => {
    const durationMs = Math.round(performance.now() - start);
    clipperLog(`${step} — done`, { durationMs });
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Runs a synchronous block and logs wall time plus optional detail fields. */
export function clipperMeasureSync<T>(
  step: string,
  fn: () => T,
  detail?: (result: T) => Record<string, unknown>,
): T {
  const start = performance.now();
  const result = fn();
  const durationMs = Math.round(performance.now() - start);
  clipperLog(step, { durationMs, ...detail?.(result) });
  return result;
}
