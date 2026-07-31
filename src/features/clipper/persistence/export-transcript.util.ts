import type { ClipperGeneratedClip } from "../engine/segmentation";
import { formatDurationMmSs } from "../../../shared/utils/time.util";

export interface ClipExportTranscript {
  transcriptPlain: string;
  transcriptTimestamped: string;
}

function buildFromWordCues(clip: ClipperGeneratedClip): ClipExportTranscript {
  const words = clip.words
    .map((word) => ({
      ...word,
      text: word.text.trim(),
    }))
    .filter((word) => word.text.length > 0);

  const transcriptPlain = words.map((word) => word.text).join(" ").trim();
  const transcriptTimestamped = words
    .map((word) => `[${formatDurationMmSs(word.start)}] ${word.text}`)
    .join("\n");

  return { transcriptPlain, transcriptTimestamped };
}

function buildFromCaptionGroups(clip: ClipperGeneratedClip): ClipExportTranscript {
  const groups = clip.captionGroups
    .map((group) => ({
      start: group.start,
      text: group.words.map((word) => word.text).join(" ").trim(),
    }))
    .filter((group) => group.text.length > 0);

  const transcriptPlain = groups.map((group) => group.text).join(" ").trim();
  const transcriptTimestamped = groups
    .map((group) => `[${formatDurationMmSs(group.start)}] ${group.text}`)
    .join("\n");

  return { transcriptPlain, transcriptTimestamped };
}

function buildFromSegmentTranscripts(clip: ClipperGeneratedClip): ClipExportTranscript {
  const segments = clip.segmentTranscripts
    .map((segment) => ({
      ...segment,
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0);

  const transcriptPlain = segments.map((segment) => segment.text).join(" ").trim();

  let outputOffsetSec = 0;
  const transcriptTimestamped = segments
    .map((segment) => {
      const line = `[${formatDurationMmSs(outputOffsetSec)}] ${segment.text}`;
      outputOffsetSec += Math.max(0, segment.endSec - segment.startSec);
      return line;
    })
    .join("\n");

  return { transcriptPlain, transcriptTimestamped };
}

/** Plain and timestamped transcript for a clip — saved with each export. */
export function buildClipExportTranscript(clip: ClipperGeneratedClip): ClipExportTranscript {
  if (clip.words.length > 0) {
    return buildFromWordCues(clip);
  }

  if (clip.captionGroups.length > 0) {
    return buildFromCaptionGroups(clip);
  }

  return buildFromSegmentTranscripts(clip);
}

const TIMESTAMP_LINE_RE = /^\[([^\]]+)\]\s*(.+)$/;

export interface TimestampedTranscriptChunk {
  timestamp: string;
  text: string;
}

function parseTimestampToSeconds(timestamp: string): number | null {
  const parts = timestamp.split(":").map((part) => Number(part));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function parseTimestampedTranscriptLines(timestamped: string): TimestampedTranscriptChunk[] {
  return timestamped
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = TIMESTAMP_LINE_RE.exec(line);
      if (!match) return null;
      const text = match[2].trim();
      if (!text) return null;
      return { timestamp: match[1], text };
    })
    .filter((chunk): chunk is TimestampedTranscriptChunk => chunk !== null);
}

/** Groups per-word timestamped lines into inline phrases for readable display. */
export function groupTimestampedTranscriptForInlineDisplay(
  timestamped: string,
  options?: { gapThresholdSec?: number },
): TimestampedTranscriptChunk[] {
  const lines = parseTimestampedTranscriptLines(timestamped);
  if (lines.length === 0) return [];

  const gapThreshold = options?.gapThresholdSec ?? 4;
  const chunks: TimestampedTranscriptChunk[] = [];
  let current: TimestampedTranscriptChunk | null = null;
  let previousSec: number | null = null;

  const pushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    const lineSec = parseTimestampToSeconds(line.timestamp);
    const gapBreak =
      current !== null &&
      lineSec !== null &&
      previousSec !== null &&
      lineSec - previousSec >= gapThreshold;

    if (current === null || gapBreak) {
      pushCurrent();
      current = { timestamp: line.timestamp, text: line.text };
    } else {
      current.text = `${current.text} ${line.text}`;
    }

    if (/[.!?]$/.test(line.text)) {
      pushCurrent();
    }

    if (lineSec !== null) previousSec = lineSec;
  }

  pushCurrent();
  return chunks;
}

export function formatTimestampedTranscriptInline(timestamped: string): string {
  return groupTimestampedTranscriptForInlineDisplay(timestamped)
    .map((chunk) => `[${chunk.timestamp}] ${chunk.text}`)
    .join(" ");
}
