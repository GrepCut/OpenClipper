import {
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database.util";
import type { WordCue } from "../lib/media/transcription-export.util";

const NAMESPACE = "clipper-range-words";

/** Persists the range transcript for a project (canonical source for reopen). */
export async function saveClipperRangeWords(
  projectId: string,
  words: WordCue[],
): Promise<WordCue[]> {
  return localRecordPut(NAMESPACE, projectId, projectId, words);
}

/** Loads the range transcript saved for this project. Missing/invalid → []. */
export async function fetchClipperRangeWords(projectId: string): Promise<WordCue[]> {
  try {
    const stored = await localRecordGet<WordCue[]>(NAMESPACE, projectId);
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}
