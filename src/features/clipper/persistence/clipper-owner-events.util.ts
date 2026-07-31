export const CLIPPER_OWNERS_CHANGED_EVENT = "clipper-owners-changed";

export function emitClipperOwnersChanged(): void {
  window.dispatchEvent(new CustomEvent(CLIPPER_OWNERS_CHANGED_EVENT));
}

export function onClipperOwnersChanged(listener: () => void): () => void {
  window.addEventListener(CLIPPER_OWNERS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CLIPPER_OWNERS_CHANGED_EVENT, listener);
}
