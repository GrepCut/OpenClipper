import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WordCue } from "../lib/media/transcription-export.util";

/**
 * In-memory stand-in for the clipper-range-words localRecord contract:
 * key = projectId, value = WordCue[].
 */
function createRangeWordsStore() {
  const store = new Map<string, WordCue[]>();
  return {
    async save(projectId: string, words: WordCue[]) {
      store.set(projectId, words);
      return words;
    },
    async fetch(projectId: string) {
      return store.get(projectId) ?? [];
    },
  };
}

describe("clipper-range-words store contract", () => {
  it("round-trips WordCue[] for a projectId", async () => {
    const api = createRangeWordsStore();
    const projectId = "proj-1";
    const words: WordCue[] = [
      { text: "one", start: 0, end: 0.3 },
      { text: "two", start: 0.4, end: 0.7 },
    ];

    await api.save(projectId, words);
    assert.deepEqual(await api.fetch(projectId), words);
  });

  it("returns empty array when nothing saved", async () => {
    const api = createRangeWordsStore();
    assert.deepEqual(await api.fetch("missing"), []);
  });
});
