/**
 * Out-of-space failures surface as raw OS / SQLite / muxer strings from Tauri commands
 * (Windows `os error 112`/`os error 39`, POSIX ENOSPC `os error 28`, SQLite code 13, FFmpeg mux errors).
 */
const DISK_FULL_PATTERN =
  /os error (112|28|39)\b|not enough space on the disk|no space left on device|ENOSPC|disk is full|SQLITE_FULL|\(code: 13\)/i;

export const DISK_FULL_MESSAGE =
  "Not enough free disk space to finish. Free up space on your drive and try again.";

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "";
  }
}

export function isDiskFullError(error: unknown): boolean {
  // Web storage quota (browser builds) is a DOMException name, not a message.
  if (error instanceof DOMException && error.name === "QuotaExceededError") return true;
  return DISK_FULL_PATTERN.test(errorMessageOf(error));
}
