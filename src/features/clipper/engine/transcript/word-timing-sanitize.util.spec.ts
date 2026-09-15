import { describe, expect, it } from "vitest";
import { wordCuesToCaptionGroups } from "../../lib/media/transcription-export.util";
import { sanitizeWordCueTimings } from "./word-timing-sanitize.util";

const cue = (text: string, start: number, end: number) => ({ text, start, end });

describe("sanitizeWordCueTimings", () => {
  it("pulls a stretched first word start forward and keeps its end", () => {
    const words = sanitizeWordCueTimings(
      [cue("Hej", 0, 18), cue("wszystkim", 18, 18.4), cue("tutaj", 18.4, 18.7)],
      30,
    );
    expect(words[0]!.end).toBe(18);
    expect(words[0]!.start).toBeGreaterThan(17);
  });

  it("repairs reversed ends and overlaps without reordering words", () => {
    const words = sanitizeWordCueTimings(
      [cue("a", 1, 0.5), cue("b", 1.2, 1.6), cue("c", 1.5, 1.9)],
      10,
    );
    expect(words.map((w) => w.text)).toEqual(["a", "b", "c"]);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end);
    }
  });
});

describe("wordCuesToCaptionGroups", () => {
  it("breaks on pauses, sentence ends, word amount and long words", () => {
    const groups = wordCuesToCaptionGroups(
      [
        cue("to", 0, 0.2),
        cue("jest", 0.2, 0.4),
        cue("koniec.", 0.4, 0.8),
        cue("nowe", 0.9, 1.1),
        cue("zdanie", 2.5, 2.9),
        cue("konstantynopolitańczykowianeczka", 3, 4),
        cue("a", 4, 4.1),
        cue("b", 4.1, 4.2),
        cue("c", 4.2, 4.3),
      ],
      2,
    );
    expect(groups.map((g) => g.words.map((w) => w.text).join(" "))).toEqual([
      "to jest",
      "koniec.",
      "nowe",
      "zdanie",
      "konstantynopolitańczykowianeczka",
      "a b",
      "c",
    ]);
  });
});
