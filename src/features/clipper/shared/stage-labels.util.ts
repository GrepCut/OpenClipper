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
 * One phase, one line. Stage messages and progress-bar labels are produced by different
 * layers and describe the same instant, so painting both always reads as a duplicate
 * ("Transcribing speech (Groq Whisper)…" above "Preparing audio 89%"). Whenever a bar is
 * present it owns the line, because its label is what the percentage actually measures.
 *
 * The one exception is a bar label that is a shortened form of the message
 * ("Decoding video" vs "Decoding video and analyzing action…"): there the fuller wording
 * describes the same work, so it moves onto the bar instead.
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
  const preferMessage = redundant && normalizedMessage.length >= normalizedDetail.length;

  return { message: null, detailLabel: preferMessage ? message : detailLabel };
}
