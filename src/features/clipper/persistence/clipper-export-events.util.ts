import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../../shared/utils/platform.util";

export const CLIPPER_EXPORTS_CHANGED_EVENT = "clipper-exports-changed";

export interface ClipperExportsChangedDetail {
  projectId?: string;
  exportId?: string;
  reason?: string;
}

export function emitClipperExportsChanged(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent<ClipperExportsChangedDetail>(CLIPPER_EXPORTS_CHANGED_EVENT, {
      detail: { projectId },
    }),
  );
}

export function subscribeClipperExportsChanged(
  listener: (detail: ClipperExportsChangedDetail) => void,
): () => void {
  const windowHandler = (event: Event) => {
    const custom = event as CustomEvent<ClipperExportsChangedDetail>;
    if (custom.detail) {
      listener(custom.detail);
    }
  };
  window.addEventListener(CLIPPER_EXPORTS_CHANGED_EVENT, windowHandler);

  let tauriUnlisten: (() => void) | null = null;
  let disposed = false;

  if (isTauri()) {
    void listen<ClipperExportsChangedDetail>(CLIPPER_EXPORTS_CHANGED_EVENT, (event) => {
      listener(event.payload);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      tauriUnlisten = unlisten;
    });
  }

  return () => {
    disposed = true;
    window.removeEventListener(CLIPPER_EXPORTS_CHANGED_EVENT, windowHandler);
    tauriUnlisten?.();
  };
}

export function onClipperExportsChanged(
  listener: (detail: ClipperExportsChangedDetail) => void,
): () => void {
  return subscribeClipperExportsChanged(listener);
}
