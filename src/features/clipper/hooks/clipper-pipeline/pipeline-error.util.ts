export function describeClipperError(error: unknown): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : "Something went wrong while creating your clip.";
  if (/file too large|FST_REQ_FILE_TOO_LARGE/i.test(message)) {
    message =
      "The audio upload was too large for the server. The clip is sent as compressed MP3 — if this persists, contact support.";
  }
  return message;
}
