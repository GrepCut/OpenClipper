import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipPayloadFromWordRanges,
  deriveWordRangesFromClip,
} from "../../engine/transcript";
import type { ClipperClipPayload } from "../../persistence/clipper-clips-api.util";
import type { ClipperGeneratedClip } from "../../engine/types/segmentation.types";
import type { WordCue } from "../../lib/media/transcription-export.util";

/** Mirrors clipsToPayload word-index path without importing session/platform deps. */
function clipsToPayloadWithWords(
  clips: ClipperGeneratedClip[],
  rangeWords: WordCue[],
  rangeDurationSec = Infinity,
): ClipperClipPayload[] {
  return clips.map((clip) => {
    if (rangeWords.length) {
      const ranges = deriveWordRangesFromClip(clip, rangeWords);
      const withIndices = clipPayloadFromWordRanges(
        clip.index,
        ranges,
        rangeWords,
        undefined,
        rangeDurationSec,
      );
      if (withIndices) return withIndices;
    }
    return {
      index: clip.index,
      startSec: clip.startSec,
      endSec: clip.endSec,
      segments: clip.segments.map((seg, orderIndex) => ({
        orderIndex,
        startSec: seg.startSec,
        endSec: seg.endSec,
      })),
    };
  });
}

function makeClip(
  index: number,
  startSec: number,
  endSec: number,
  words: WordCue[] = [],
): ClipperGeneratedClip {
  return {
    index,
    startSec,
    endSec,
    durationSec: endSec - startSec,
    words,
    captionGroups: [],
    segments: [{ startSec, endSec }],
    segmentTranscripts: [{ startSec, endSec, text: words.map((w) => w.text).join(" ") }],
  };
}

describe("clipsToPayload word indices", () => {
  it("stores wordStartIdx/wordEndIdx when rangeWords are provided", () => {
    const rangeWords: WordCue[] = [
      { text: "hello", start: 0, end: 0.4 },
      { text: "world", start: 0.5, end: 0.9 },
      { text: "again", start: 1.0, end: 1.4 },
    ];
    const clips = [makeClip(0, 0, 1.0, rangeWords.slice(0, 2))];

    const payload = clipsToPayloadWithWords(clips, rangeWords, 60);

    assert.equal(payload.length, 1);
    assert.ok(payload[0].segments.length >= 1);
    for (const segment of payload[0].segments) {
      assert.equal(typeof segment.wordStartIdx, "number");
      assert.equal(typeof segment.wordEndIdx, "number");
      assert.ok((segment.wordStartIdx ?? 0) <= (segment.wordEndIdx ?? 0));
    }
  });

  it("omits word indices when rangeWords are empty", () => {
    const clips = [makeClip(0, 0, 1)];
    const payload = clipsToPayloadWithWords(clips, [], 60);
    assert.equal(payload[0].segments[0].wordStartIdx, undefined);
    assert.equal(payload[0].segments[0].wordEndIdx, undefined);
  });
});
