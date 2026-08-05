import type { Transcription, TranscriptionSegment } from "../../../../services/types/transcription.types";

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function secondsToSrtTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mill = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mill, 3)}`;
}

function secondsToVttTimestamp(seconds: number): string {
  return secondsToSrtTimestamp(seconds).replace(",", ".");
}

export function transcriptionToSrt(transcription: Transcription): string {
  return transcription.segments
    .map((seg, index) => {
      const start = secondsToSrtTimestamp(seg.startTime);
      const end = secondsToSrtTimestamp(seg.endTime);
      return `${index + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
    })
    .join("\n")
    .trim();
}

export function transcriptionToVtt(transcription: Transcription): string {
  const body = transcription.segments
    .map((seg) => {
      const start = secondsToVttTimestamp(seg.startTime);
      const end = secondsToVttTimestamp(seg.endTime);
      return `${start} --> ${end}\n${seg.text.trim()}\n`;
    })
    .join("\n")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export interface WordCue {
  text: string;
  start: number;
  end: number;
}

export interface CaptionGroup {
  words: WordCue[];
  start: number;
  end: number;
}

export function segmentsToWordCues(segments: TranscriptionSegment[]): WordCue[] {
  const words: WordCue[] = [];

  for (const seg of segments) {
    words.push(...segmentToWordCues(seg));
  }

  return words;
}

function segmentToWordCues(seg: TranscriptionSegment): WordCue[] {
  const tokens = seg.text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const duration = Math.max(0.05, seg.endTime - seg.startTime);
  const wordDuration = duration / tokens.length;

  return tokens.map((text, index) => ({
    text,
    start: seg.startTime + index * wordDuration,
    end: seg.startTime + (index + 1) * wordDuration,
  }));
}

export function wordCuesToCaptionGroups(
  words: WordCue[],
  wordsPerGroup: number,
): CaptionGroup[] {
  if (wordsPerGroup <= 0 || words.length === 0) return [];

  const groups: CaptionGroup[] = [];
  for (let i = 0; i < words.length; i += wordsPerGroup) {
    const chunk = words.slice(i, i + wordsPerGroup);
    if (chunk.length === 0) continue;
    const start = chunk[0]!.start;
    const rawEnd = chunk[chunk.length - 1]!.end;
    const nextWord = words[i + wordsPerGroup];
    let end =
      nextWord && nextWord.start < rawEnd ? nextWord.start : rawEnd;
    if (end <= start) {
      continue;
    }
    groups.push({
      words: chunk,
      start,
      end,
    });
  }
  return groups;
}

export function resolveNonOverlappingCaptionGroups(
  groups: readonly CaptionGroup[],
): CaptionGroup[] {
  if (groups.length === 0) return [];

  const sorted = [...groups].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });

  const resolved: CaptionGroup[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const group = sorted[i]!;
    const next = sorted[i + 1];
    let end = group.end;
    if (next && next.start < end) {
      end = next.start;
    }
    if (end <= group.start) continue;
    resolved.push({ ...group, end });
  }
  return resolved;
}

export function segmentsToCaptionGroups(segments: TranscriptionSegment[]): CaptionGroup[] {
  return segments
    .map((seg) => {
      const words = segmentToWordCues(seg);
      if (words.length === 0) return null;
      return {
        words,
        start: seg.startTime,
        end: seg.endTime,
      };
    })
    .filter((group): group is CaptionGroup => group != null);
}
