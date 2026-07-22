export type VideoFrameCallbackCompat = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function truncatePreviewUrl(url: string, maxLen = 80): string {
  if (url.length <= maxLen) return url;
  return `${url.slice(0, maxLen)}…`;
}
