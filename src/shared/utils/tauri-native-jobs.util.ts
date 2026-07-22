import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform.util";

export interface NativeJobErrorPayload {
  code?: string;
  message: string;
  fatal?: boolean;
}

export type NativeJobMessage<TProgress, TResult> =
  | { type: "progress"; payload: TProgress }
  | { type: "result"; payload: TResult }
  | { type: "error"; payload: NativeJobErrorPayload };

export interface NativeJobEnvelope<TProgress = unknown, TResult = unknown> {
  sessionId: string;
  jobId: string;
  sequence: number;
  message: NativeJobMessage<TProgress, TResult>;
}

interface NativeJobHandler {
  nextSequence: number;
  pending: Map<number, NativeJobEnvelope>;
  receive: (envelope: NativeJobEnvelope) => void;
}

interface NativeJobWindow extends Window {
  __OPEN_CLIPPER_FRONTEND_SESSION_ID__?: string;
  __OPEN_CLIPPER_FRONTEND_READY__?: Promise<void>;
  __OPEN_CLIPPER_NATIVE_JOB_HANDLERS__?: Map<string, NativeJobHandler>;
  __OPEN_CLIPPER_NATIVE_JOB_DISPATCH__?: (envelope: NativeJobEnvelope) => void;
}

function nativeWindow(): NativeJobWindow {
  return window as NativeJobWindow;
}

function newId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function getTauriFrontendSessionId(): string {
  const target = nativeWindow();
  target.__OPEN_CLIPPER_FRONTEND_SESSION_ID__ ??= newId("frontend");
  return target.__OPEN_CLIPPER_FRONTEND_SESSION_ID__;
}

export function createTauriNativeJobId(prefix: string): string {
  return newId(prefix);
}

function handlers(): Map<string, NativeJobHandler> {
  const target = nativeWindow();
  target.__OPEN_CLIPPER_NATIVE_JOB_HANDLERS__ ??= new Map();
  return target.__OPEN_CLIPPER_NATIVE_JOB_HANDLERS__;
}

function installDispatcher(): void {
  const target = nativeWindow();
  target.__OPEN_CLIPPER_NATIVE_JOB_DISPATCH__ = (envelope) => {
    if (envelope.sessionId !== getTauriFrontendSessionId()) return;
    handlers().get(envelope.jobId)?.receive(envelope);
  };
}

export function ensureTauriFrontendSession(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  installDispatcher();
  const target = nativeWindow();
  if (!target.__OPEN_CLIPPER_FRONTEND_READY__) {
    const sessionId = getTauriFrontendSessionId();
    target.__OPEN_CLIPPER_FRONTEND_READY__ = invoke<void>("frontend_ready", { sessionId })
      .catch((error) => {
        delete target.__OPEN_CLIPPER_FRONTEND_READY__;
        throw error;
      });
  }
  return target.__OPEN_CLIPPER_FRONTEND_READY__;
}

export class TauriNativeJobError extends Error {
  readonly code?: string;
  readonly fatal?: boolean;

  constructor(payload: NativeJobErrorPayload) {
    super(payload.message);
    this.name = "TauriNativeJobError";
    this.code = payload.code;
    this.fatal = payload.fatal;
  }
}

function abortError(): DOMException {
  return new DOMException("Conversion aborted", "AbortError");
}

export async function runTauriNativeJob<TProgress, TResult>(options: {
  jobId: string;
  startCommand: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  onProgress?: (progress: TProgress) => void;
}): Promise<TResult> {
  await ensureTauriFrontendSession();
  if (options.signal?.aborted) throw abortError();

  const sessionId = getTauriFrontendSessionId();
  const registry = handlers();

  return new Promise<TResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      registry.delete(options.jobId);
      options.signal?.removeEventListener("abort", cancel);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const cancel = () => {
      void invoke("cancel_clipper_native_job", { sessionId, jobId: options.jobId }).catch(() => {});
      settle(() => reject(abortError()));
    };

    const handler: NativeJobHandler = {
      nextSequence: 0,
      pending: new Map(),
      receive: (envelope) => {
        if (settled || envelope.sequence < handler.nextSequence) return;
        handler.pending.set(envelope.sequence, envelope);
        while (handler.pending.has(handler.nextSequence)) {
          const next = handler.pending.get(handler.nextSequence)!;
          handler.pending.delete(handler.nextSequence);
          handler.nextSequence++;
          const message = next.message as NativeJobMessage<TProgress, TResult>;
          if (message.type === "progress") {
            try {
              options.onProgress?.(message.payload);
            } catch (error) {
              void invoke("cancel_clipper_native_job", { sessionId, jobId: options.jobId }).catch(() => {});
              settle(() => reject(error));
              return;
            }
          } else if (message.type === "result") {
            settle(() => resolve(message.payload));
            return;
          } else {
            settle(() => reject(new TauriNativeJobError(message.payload)));
            return;
          }
        }
      },
    };

    registry.set(options.jobId, handler);
    options.signal?.addEventListener("abort", cancel, { once: true });

    void invoke<void>(options.startCommand, {
      ...options.args,
      sessionId,
      jobId: options.jobId,
    }).catch((error) => {
      settle(() => reject(error));
    });
  });
}

installDispatcher();
