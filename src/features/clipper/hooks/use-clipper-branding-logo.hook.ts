import { useEffect, useState } from "react";
import {
  ensureBrandingLogo,
  isBrandingLogoMissing,
  subscribeBrandingLogo,
} from "../engine/render/branding-logo-cache.util";

/**
 * Preloads the branding logo. `epoch` bumps whenever any logo finishes loading
 * (no matter which consumer requested it) so a paused preview can redraw.
 */
export function useClipperBrandingLogo(imagePath: string | null): {
  epoch: number;
  missing: boolean;
} {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => subscribeBrandingLogo(() => setEpoch((current) => current + 1)), []);

  useEffect(() => {
    if (imagePath) void ensureBrandingLogo(imagePath);
  }, [imagePath]);

  return { epoch, missing: isBrandingLogoMissing(imagePath) };
}
