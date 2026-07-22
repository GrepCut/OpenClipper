import { EncodedPacketSink } from "mediabunny";
import type { WordCue } from "../../lib/media/transcription-export.util";
import { createMediabunnyInput } from "../../lib/media/mediabunny-file-source.util";
import { clipperLog, clipperTimer } from "../../shared/logger.util";
import { yieldToMain } from "../../shared/yield-to-main.util";
import {
  CLIPPER_SEGMENT_LENGTH_SEC,
  type ClipperGeneratedClip,
} from "./segmentation.types";
import { segmentRangeIntoClips, segmentRangeIntoClipsAtKeyframes } from "./boundaries.util";

/** Scans video keyframe timestamps from a trimmed range file (metadata-only, fast). */
export async function collectVideoKeyframeTimestamps(
  file: File,
  options: { signal?: AbortSignal; maxDurationSec?: number } = {},
): Promise<number[]> {
  const input = await createMediabunnyInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return [0];

    const sink = new EncodedPacketSink(videoTrack);
    const timestamps: number[] = [];
    let packet = await sink.getFirstPacket({ metadataOnly: true });
    let packetCount = 0;

    while (packet) {
      if (options.signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
      if (options.maxDurationSec != null && packet.timestamp > options.maxDurationSec) break;
      if (packet.type === "key") timestamps.push(packet.timestamp);
      packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
      packetCount++;
      if (packetCount % 200 === 0) {
        await yieldToMain();
      }
    }

    if (timestamps.length === 0 || timestamps[0] > 0) timestamps.unshift(0);
    return timestamps;
  } finally {
    input.dispose();
  }
}

/** Keyframe-aware segmentation from the trimmed range file; falls back to fixed splits. */
export async function segmentRangeFromTrimmedFile(
  trimmedFile: File,
  rangeDurationSec: number,
  words: WordCue[],
  wordsPerGroup: number,
  options: {
    signal?: AbortSignal;
    targetLengthSec?: number;
    onKeyframes?: (keyframes: number[]) => void;
  } = {},
): Promise<ClipperGeneratedClip[]> {
  const targetLengthSec = options.targetLengthSec ?? CLIPPER_SEGMENT_LENGTH_SEC;
  try {
    const endKeyframeScan = clipperTimer("resume: keyframe-scan");
    const keyframes = await collectVideoKeyframeTimestamps(trimmedFile, {
      signal: options.signal,
      maxDurationSec: rangeDurationSec,
    });
    endKeyframeScan();
    options.onKeyframes?.(keyframes);
    const clips = segmentRangeIntoClipsAtKeyframes(
      rangeDurationSec,
      words,
      wordsPerGroup,
      keyframes,
      targetLengthSec,
    );
    clipperLog("segment: keyframe-aligned clips", {
      clipCount: clips.length,
      keyframeCount: keyframes.length,
      targetLengthSec,
      durations: clips.map((c) => Math.round(c.durationSec)),
    });
    return clips;
  } catch (error) {
    clipperLog("segment: keyframe scan failed — fixed-length fallback", { error, targetLengthSec });
    return segmentRangeIntoClips(rangeDurationSec, words, wordsPerGroup, targetLengthSec);
  }
}
