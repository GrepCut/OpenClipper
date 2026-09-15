import { captionWordsPerGroup } from "../lib/captions/caption-presets.util";
import type { ClipperSettings } from "../settings/settings.util";
import { findClipByIndex } from "../engine/segmentation";
import type { ClipperFrameContext } from "../engine/render/index";
import { groupCaptionWords, type AiClipSegmentRange } from "../engine/transcript";
import {
  getActiveClips,
  normalizeClipperSession,
  resolveFaceRender,
  type ClipperSession,
} from "./session.util";

/** Builds frame draw context for a specific generated clip within the trimmed range. */
export function buildFrameContext(
  session: ClipperSession,
  settings: ClipperSettings,
  clipIndex = session.activeClipIndex,
): ClipperFrameContext | null {
  if (!session) return null;

  normalizeClipperSession(session);
  const clip = findClipByIndex(getActiveClips(session), clipIndex);
  if (!clip) return null;

  const wordsPerGroup = captionWordsPerGroup(settings.captions);
  let cached = session.captionGroupsCache;
  if (!cached || cached.wordsPerGroup !== wordsPerGroup || cached.clip !== clip) {
    cached = {
      wordsPerGroup,
      clip,
      groups:
        clip.words.length > 0
          ? groupCaptionWords(clip.words, wordsPerGroup)
          : clip.captionGroups,
    };
    session.captionGroupsCache = cached;
  }

  return {
    ...sessionFrameContextBase(session, settings),
    captionGroups: cached.groups,
    segments: clip.segments,
  };
}

function sessionFrameContextBase(
  session: ClipperSession,
  settings: ClipperSettings,
): Omit<ClipperFrameContext, "captionGroups" | "segments"> {
  return {
    settings,
    faceCache: session.faceCache,
    faceRender: resolveFaceRender(session),
    smartCropAnalysis: session.smartCropAnalysis,
    disabledCollageRegionIds: session.disabledCollageRegionIds ?? [],
  };
}

/** Frame context for a word range (no clip required); `null` range = whole trimmed range. */
export function buildRangeFrameContext(
  session: ClipperSession,
  settings: ClipperSettings,
  range: AiClipSegmentRange | null,
): ClipperFrameContext {
  normalizeClipperSession(session);
  const words = range
    ? session.rangeWords.slice(
        Math.min(range.wordStartIdx, range.wordEndIdx),
        Math.max(range.wordStartIdx, range.wordEndIdx) + 1,
      )
    : session.rangeWords;
  const first = words[0];
  const last = words.at(-1);
  const hasRange = Boolean(range && first && last);
  const captionWords = hasRange
    ? words.map((word) => ({ ...word, start: word.start - first!.start, end: word.end - first!.start }))
    : words;
  return {
    ...sessionFrameContextBase(session, settings),
    captionGroups: groupCaptionWords(captionWords, captionWordsPerGroup(settings.captions)),
    segments: hasRange ? [{ startSec: first!.start, endSec: last!.end }] : undefined,
  };
}
