export interface ProcessingLabels {
  /** Standalone line above the bar, or null when the bar already says it. */
  message: string | null;
  /** Label for the progress bar, or null when there is no bar. */
  detailLabel: string | null;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[.…\s]+$/u, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/**
 * Stage messages and progress-bar labels come from different layers and routinely restate
 * each other ("Decoding video and analyzing action…" vs "Decoding video"). When they overlap
 * the more descriptive one wins and moves onto the bar, so only one line is ever painted.
 */
export function resolveProcessingLabels(
  stageMessage: string,
  stageDetailLabel: string | null,
): ProcessingLabels {
  const message = stageMessage.trim();
  const detailLabel = stageDetailLabel?.trim() ?? "";

  if (!detailLabel) return { message: message || null, detailLabel: null };
  if (!message) return { message: null, detailLabel };

  const normalizedMessage = normalize(message);
  const normalizedDetail = normalize(detailLabel);
  const redundant =
    normalizedMessage.startsWith(normalizedDetail) ||
    normalizedDetail.startsWith(normalizedMessage);

  if (!redundant) return { message, detailLabel };

  return {
    message: null,
    detailLabel: normalizedMessage.length >= normalizedDetail.length ? message : detailLabel,
  };
}
