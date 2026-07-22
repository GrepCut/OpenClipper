/** `m:ss` from seconds (rounded, non-negative). */
export function formatDurationMmSs(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** `m:ss.s` with one decimal place. */
export function formatDurationMmSsDecimal(time: number): string {
  const m = Math.floor(time / 60);
  const s = (time % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

/** Short calendar date for list rows. */
export function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Human-readable duration from total seconds (e.g. `2m 30s`). */
export function formatHumanDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** UTC timestamp for export filenames: `YYYYMMDD-HHMMSS`. */
export function formatExportTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}
