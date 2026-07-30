export type VideoFrameCallbackCompat = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function truncatePreviewUrl(url: string | null | undefined, maxLen = 80): string {
  if (!url) return "(none)";
  if (url.length <= maxLen) return url;
  return `${url.slice(0, maxLen)}…`;
}
