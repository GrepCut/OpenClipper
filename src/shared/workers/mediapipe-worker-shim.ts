/**
 * Polyfills required by @mediapipe/tasks-vision inside Vite ES module workers.
 * Import before any mediapipe code in worker entry files.
 */

type MediapipeWorkerGlobal = typeof globalThis & {
  import?: (url: string) => Promise<unknown>;
  ModuleFactory?: unknown;
};

const workerGlobal = globalThis as MediapipeWorkerGlobal;

if (typeof workerGlobal.document === "undefined") {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "createElement") {
        return (tag: string) => {
          if (tag === "canvas") return new OffscreenCanvas(1, 1);
          return {};
        };
      }
      return undefined;
    },
    has() {
      return false;
    },
  };
  (workerGlobal as unknown as { document: unknown }).document = new Proxy(
    {},
    handler,
  );
}

if (typeof workerGlobal.import !== "function") {
  workerGlobal.import = async (url: string) => {
    const module = (await import(/* @vite-ignore */ url)) as {
      default?: unknown;
    };
    if (module.default) {
      workerGlobal.ModuleFactory = module.default;
    }
    return module;
  };
}
