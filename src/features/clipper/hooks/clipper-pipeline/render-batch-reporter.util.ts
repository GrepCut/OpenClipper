import type { PipelineReporter } from "../../pipeline/reporter.util";

export interface RenderBatchReporter {
  reporter: PipelineReporter;
  /** Forget keys of a clip whose job has returned (its final state is patched explicitly). */
  releaseKeys: () => void;
  /**
   * Resets keys still in flight with a terminal `null`, which also flushes whatever the
   * throttled reporter buffered — otherwise a stopped batch repaints "rendering 40%".
   */
  resetInFlightProgress: () => void;
}

/** Scopes render progress to one batch; ticks arriving after abort are dropped. */
export function createRenderBatchReporter(
  reporter: PipelineReporter,
  signal: AbortSignal,
): RenderBatchReporter {
  const inFlightKeys = new Set<string>();

  return {
    reporter: {
      ...reporter,
      renderProgress: (key, ratio) => {
        if (signal.aborted) return;
        inFlightKeys.add(key);
        reporter.renderProgress(key, ratio);
      },
    },
    releaseKeys: () => inFlightKeys.clear(),
    resetInFlightProgress: () => {
      for (const key of inFlightKeys) reporter.renderProgress(key, null);
      inFlightKeys.clear();
    },
  };
}
