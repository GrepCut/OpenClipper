import type { ClipperGeneratedClip } from "../engine/segmentation";
import type { ClipperSettings } from "../settings/settings.util";
import {
  collageRegionCacheKey,
  layoutRegionsCacheKey,
  type ClipperSession,
} from "./session.util";

type RenderSignatureSession = Pick<
  ClipperSession,
  "disabledCollageRegionIds" | "smartCropAnalysis"
>;

/**
 * cyrb53 — 53-bit non-cryptographic hash. A collision would make "skip already exported"
 * drop a render that is actually needed, so 32 bits is not enough here.
 */
function cyrb53(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Fingerprint of everything that changes a clip's rendered pixels/audio. It is stored with
 * every export, so "Continue" and "Skip already exported" only skip a format whose file was
 * encoded from identical inputs; editing a clip (bounds, captions, branding, collage
 * regions, …) makes it renderable again. Must stay stable across app restarts — no
 * in-memory counters. Filename template and format selection are deliberately excluded.
 */
export function computeClipRenderSignature(
  session: RenderSignatureSession,
  settings: ClipperSettings,
  clip: ClipperGeneratedClip,
): string {
  return cyrb53(
    JSON.stringify([
      settings.captions,
      settings.branding,
      settings.audio,
      settings.formats.quality,
      settings.formats.resolutionCap,
      clip.segments.map((segment) => [segment.startSec, segment.endSec]),
      clip.words.length > 0
        ? clip.words.map((word) => [word.text, word.start, word.end])
        : clip.captionGroups,
      collageRegionCacheKey(session.disabledCollageRegionIds ?? []),
      layoutRegionsCacheKey(session.smartCropAnalysis),
    ]),
  );
}
