import { drawVerticalSplitFrame, evenInt } from "../../../lib/media/video-draw.util";
import type { FrameEffectSize } from "../../../lib/media/video-frame-effect.util";
import { cropRectForCentroid, interpolateCentroid } from "../index";
import type { CollageTracks } from "../../types/collage.types";
import type { PodcastCollageLayout } from "../../types/collage.types";

const COLLAGE_DIVIDER_PX = 3;

/** Pure source-space layout shared by rendering and the manual benchmark. */
export function resolvePodcastCollageLayout(
  source: FrameEffectSize,
  output: FrameEffectSize,
  tracks: CollageTracks,
  t: number,
): PodcastCollageLayout {
  const halfH = evenInt(output.height / 2);
  const bottomH = output.height - halfH;
  const topCentroid = interpolateCentroid(tracks.top, t);
  const bottomCentroid = interpolateCentroid(tracks.bottom, t);
  return {
    halfH,
    bottomH,
    topCrop: cropRectForCentroid(
      source.width,
      source.height,
      topCentroid.x,
      topCentroid.y,
      output.width / halfH,
      topCentroid.extent,
    ),
    bottomCrop: cropRectForCentroid(
      source.width,
      source.height,
      bottomCentroid.x,
      bottomCentroid.y,
      output.width / bottomH,
      bottomCentroid.extent,
    ),
  };
}

/**
 * Draws a top/bottom podcast collage: each half independently cover-crops the
 * source around its own tracked speaker. Only meaningful for "crop" formats —
 * callers should keep "pad" (landscape/contain) formats on the normal path.
 */
export function drawPodcastCollageFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: CanvasImageSource,
  source: FrameEffectSize,
  output: FrameEffectSize,
  tracks: CollageTracks,
  t: number,
  showDivider: boolean,
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, output.width, output.height);

  const { halfH, bottomH, topCrop, bottomCrop } = resolvePodcastCollageLayout(
    source,
    output,
    tracks,
    t,
  );

  drawVerticalSplitFrame(
    ctx,
    frame,
    output,
    topCrop,
    bottomCrop,
    showDivider ? COLLAGE_DIVIDER_PX : 0,
  );
}
