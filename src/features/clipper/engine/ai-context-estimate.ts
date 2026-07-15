import type { ClipperAiChatMessage } from "../persistence/ai-clip-api";
import type { WordCue } from "../lib/media/transcription-export";

/** Matches backend `CLIPPER_AI_TRANSCRIPT_TOKEN_BUDGET`. */
export const CLIPPER_AI_CONTEXT_TOKEN_BUDGET = 96_000;

export function estimateHistoryChars(messages: ClipperAiChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

/** Mirrors backend `estimateTranscriptTokens` for UI context meter. */
export function estimateClipperAiContextTokens(
  words: WordCue[],
  options: {
    historyChars?: number;
    userMessage?: string;
    currentClipsJsonChars?: number;
  } = {},
): number {
  const wordChars = words.reduce((sum, word) => sum + word.text.length + 12, 0);
  const overhead =
    2_500 +
    (options.historyChars ?? 0) +
    (options.userMessage?.length ?? 0) +
    (options.currentClipsJsonChars ?? 0);
  return Math.ceil((wordChars + overhead) / 3.5);
}

export function formatCompactTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(tokens);
}

export function clipperAiContextUsage(
  words: WordCue[],
  options: {
    messages?: ClipperAiChatMessage[];
    userMessage?: string;
    currentClipsJsonChars?: number;
  } = {},
): { tokens: number; budget: number; percent: number; label: string } {
  const tokens = estimateClipperAiContextTokens(words, {
    historyChars: estimateHistoryChars(options.messages ?? []),
    userMessage: options.userMessage,
    currentClipsJsonChars: options.currentClipsJsonChars,
  });
  const budget = CLIPPER_AI_CONTEXT_TOKEN_BUDGET;
  const percent = Math.min(100, Math.round((tokens / budget) * 100));
  return {
    tokens,
    budget,
    percent,
    label: `${percent}% · ${formatCompactTokenCount(tokens)}`,
  };
}
