const PREFIX = "[Clipper/YouTube]";

/** Debug logging for YouTube OAuth and publish flows in Clipper. */
export function logYoutubeDebug(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`${PREFIX} ${message}`, data);
    return;
  }
  console.log(`${PREFIX} ${message}`);
}

export function logYoutubeError(message: string, error?: unknown): void {
  console.error(`${PREFIX} ${message}`, error ?? "");
}
