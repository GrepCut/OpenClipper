import {
  ALL_FORMATS,
  BlobSource,
  Input,
  UrlSource,
  type UrlSourceOptions,
} from "mediabunny";
import { isTauri } from "../../../../shared/utils/platform.util";
import { getNativeFilePath } from "../../platform/native-source.util";
import {
  isAbsoluteNativePath,
  resolveFilePlayableUrl,
} from "../../persistence/tauri-media.util";

const MAX_LOCAL_MEDIA_RETRY_ATTEMPTS = 3;
const MAX_REMOTE_MEDIA_RETRY_ATTEMPTS = 4;

function combineAbortSignals(first: AbortSignal | null | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([first, second]);
  const controller = new AbortController();
  const abort = () => {
    first.removeEventListener("abort", abort);
    second.removeEventListener("abort", abort);
    controller.abort(first.aborted ? first.reason : second.reason);
  };
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  if (first.aborted || second.aborted) abort();
  return controller.signal;
}

interface InternalOrchestratorWorker {
  currentPos: number;
  targetPos: number;
  running: boolean;
  pendingSlices: unknown[];
}

interface InternalOrchestrator {
  workers?: InternalOrchestratorWorker[];
  options?: {
    runWorker?: (worker: InternalOrchestratorWorker) => Promise<void>;
  };
}

function extractUrlString(url: string | URL | Request): string {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

export function isLocalMediaProtocolUrl(url: string | URL | Request): boolean {
  const raw = extractUrlString(url);
  return /^(https?:\/\/(grepcut-media|asset)\.localhost\/|(grepcut-media|asset):\/\/)/i.test(
    raw,
  );
}

export function defaultMediabunnyRetryDelay(
  previousAttempts: number,
  error: unknown,
  url: string | URL | Request,
): number | null {
  if (isLocalMediaProtocolUrl(url)) {
    if (error instanceof Error && error.name === "LocalMediaRangeError") return null;
    if (previousAttempts > MAX_LOCAL_MEDIA_RETRY_ATTEMPTS) {
      return null;
    }
    return 0.05 * 2 ** (previousAttempts - 1);
  }
  if (previousAttempts > MAX_REMOTE_MEDIA_RETRY_ATTEMPTS) {
    return null;
  }
  if (error instanceof TypeError && typeof window !== "undefined") {
    try {
      const originOfSrc = new URL(extractUrlString(url), window.location.href).origin;
      if (originOfSrc !== window.location.origin) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return Math.min(2 ** (previousAttempts - 2), 16);
}

/**
 * Creates a Mediabunny UrlSource configured for Tauri custom media protocols and
 * guarded against unhandled rejections from speculative background prefetch workers.
 */
export function createMediabunnyUrlSource(
  url: string | URL | Request,
  options: UrlSourceOptions = {},
): UrlSource {
  const local = isLocalMediaProtocolUrl(url);
  const fetchMedia = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const source = new UrlSource(url, {
    getRetryDelay: defaultMediabunnyRetryDelay,
    ...(local ? { maxCacheSize: 8 * 1024 * 1024, parallelism: 1 } : {}),
    ...options,
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchMedia(input, { ...init, signal: combineAbortSignals(init?.signal, controller.signal) });
      if (local && response.status === 200) {
        await response.body?.cancel();
        const error = new Error("Local video did not support byte-range reads. Reopen the source video and retry. Your project and clips are preserved.");
        error.name = "LocalMediaRangeError";
        throw error;
      }
      return response;
    },
  });

  const disposable = source as UrlSource & { _dispose: () => void };
  const originalDispose = disposable._dispose.bind(source);
  disposable._dispose = () => {
    controller.abort();
    originalDispose();
  };

  const orchestrator = (
    source as unknown as { _orchestrator?: InternalOrchestrator }
  )._orchestrator;
  const originalRunWorker = orchestrator?.options?.runWorker;
  if (orchestrator?.options && typeof originalRunWorker === "function") {
    orchestrator.options.runWorker = async (worker: InternalOrchestratorWorker) => {
      try {
        await originalRunWorker(worker);
      } catch (error) {
        if (worker.pendingSlices.length > 0) {
          throw error;
        }
        worker.targetPos = worker.currentPos;
        worker.running = false;
        if (Array.isArray(orchestrator.workers)) {
          const index = orchestrator.workers.indexOf(worker);
          if (index !== -1) {
            orchestrator.workers.splice(index, 1);
          }
        }
      }
    };
  }

  return source;
}

/** Mediabunny input for a browser File or a Tauri path-backed zero-byte File. */
export async function createMediabunnyInput(file: File): Promise<Input> {
  const path = getNativeFilePath(file);
  if (path && isTauri() && isAbsoluteNativePath(path)) {
    const url = await resolveFilePlayableUrl(file);
    return new Input({ source: createMediabunnyUrlSource(url), formats: ALL_FORMATS });
  }
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}
