export const CLIPPER_EXPORTS_CHANGED_EVENT = "clipper-exports-changed";

export interface ClipperExportsChangedDetail {
  projectId: string;
}

export function emitClipperExportsChanged(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent<ClipperExportsChangedDetail>(CLIPPER_EXPORTS_CHANGED_EVENT, {
      detail: { projectId },
    }),
  );
}

export function onClipperExportsChanged(
  listener: (detail: ClipperExportsChangedDetail) => void,
): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<ClipperExportsChangedDetail>;
    if (custom.detail?.projectId) {
      listener(custom.detail);
    }
  };
  window.addEventListener(CLIPPER_EXPORTS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(CLIPPER_EXPORTS_CHANGED_EVENT, handler);
}
