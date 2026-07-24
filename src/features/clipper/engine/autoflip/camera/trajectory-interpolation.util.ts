import type { NormalizedBox } from "../../../shared/smart-crop.util";

export interface TimedBox {
  t: number;
  box: NormalizedBox;
}

function interpolate(from: number, to: number, factor: number): number {
  return from + (to - from) * factor;
}

/**
 * Renders the already-denoised camera trajectory continuously. Scene cuts are
 * handled by callers and never reach this interpolation path.
 */
export function interpolateCameraBox(
  from: TimedBox,
  to: TimedBox,
  time: number,
): NormalizedBox {
  const factor = Math.max(0, Math.min(1, (time - from.t) / Math.max(Number.EPSILON, to.t - from.t)));
  return {
    x: interpolate(from.box.x, to.box.x, factor),
    y: interpolate(from.box.y, to.box.y, factor),
    width: interpolate(from.box.width, to.box.width, factor),
    height: interpolate(from.box.height, to.box.height, factor),
  };
}
