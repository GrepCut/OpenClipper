import * as Sentry from "@sentry/react";
import type { ClipperQualityPreset, ClipperResolutionCap } from "../settings/settings.util";

export interface RenderDiagnostics {
  stage?: "preflight" | "configure" | "encode" | "finalize";
  sourceKind?: "native-path" | "blob";
  sample?: { width: number; height: number };
  audio?: { sourceSampleRate: number; sourceChannels: number; outputSampleRate: number; outputChannels: number; mode: "copy" | "transcode" };
  source?: { codec: string | null; width: number; height: number };
  encoder?: VideoEncoderConfig;
}

export interface RenderFailureDetails extends RenderDiagnostics {
  clipIndex?: number | null;
  formatId?: string;
  quality?: ClipperQualityPreset;
  resolutionCap?: ClipperResolutionCap;
  requestedWidth?: number;
  requestedHeight?: number;
}

export type RenderFailureReporter = (
  error: unknown,
  details?: RenderFailureDetails,
  signal?: AbortSignal,
) => void;

/** One reporter per user attempt: formats report first, the UI catches the same error later. */
export function createRenderFailureReporter(
  operation: "batch" | "rerender",
  defaults: RenderFailureDetails = {},
): RenderFailureReporter {
  const reported = new Map<unknown, Set<string | undefined>>();

  return (error, details = {}, signal) => {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return;

    const context = { ...defaults, ...details };
    const formats = reported.get(error);
    // The outer handler has no format; its error was already captured by a format handler.
    if (formats && (!context.formatId || formats.has(context.formatId))) return;
    reported.set(error, (formats ?? new Set()).add(context.formatId));

    try {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        // Distinguish identical encoder failures from simultaneous output formats.
        fingerprint: ["{{ default }}", "clipper-render", operation, context.formatId ?? "setup"],
        tags: {
          feature: "clipper-render",
          operation,
          ...(context.formatId ? { format: context.formatId } : {}),
        },
        contexts: { render: { operation, ...context } },
      });
    } catch {
      // Telemetry must not replace the render error or interrupt export cleanup.
    }
  };
}
