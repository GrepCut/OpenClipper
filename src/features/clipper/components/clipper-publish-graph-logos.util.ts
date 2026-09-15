import { asset } from "../../../shared/utils/asset.util";
import type { ClipperPlatform } from "../shared/formats.util";

const PLATFORM_LOGO: Record<ClipperPlatform, string> = {
  youtube: asset("/clipper/youtube-logo.webp"),
  "youtube-shorts": asset("/clipper/youtube-shorts-logo.webp"),
  instagram: asset("/clipper/instagram-logo.webp"),
  tiktok: asset("/clipper/tiktok-logo.webp"),
  twitter: asset("/clipper/x-logo.webp"),
  threads: asset("/clipper/threads-logo.webp"),
  facebook: asset("/clipper/facebook-logo.webp"),
};

const logoCache = new Map<ClipperPlatform, HTMLImageElement>();
const logoFailed = new Set<ClipperPlatform>();

function isUsableLogo(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

export function loadPlatformLogo(
  platform: ClipperPlatform,
  onReady?: () => void,
): HTMLImageElement | null {
  if (logoFailed.has(platform)) return null;

  const cached = logoCache.get(platform);
  if (cached) {
    if (isUsableLogo(cached)) return cached;
    if (cached.complete) {
      logoFailed.add(platform);
      logoCache.delete(platform);
      return null;
    }
    return null;
  }

  const src = PLATFORM_LOGO[platform];
  if (!src) {
    logoFailed.add(platform);
    return null;
  }

  const img = new Image();
  logoCache.set(platform, img);
  img.onload = () => {
    if (!isUsableLogo(img)) {
      logoFailed.add(platform);
      logoCache.delete(platform);
      return;
    }
    onReady?.();
  };
  img.onerror = () => {
    logoFailed.add(platform);
    logoCache.delete(platform);
  };
  img.src = src;
  return isUsableLogo(img) ? img : null;
}
