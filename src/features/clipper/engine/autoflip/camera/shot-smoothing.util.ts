import type { AutoFlipCropSample, NormalizedBox } from "../../../shared/smart-crop.util";
import { OneEuroFilter } from "../filters/one-euro-filter.util";

const EPSILON = 1e-9;

function viewportArea(viewport: NormalizedBox): number {
  return Math.max(0, viewport.width) * Math.max(0, viewport.height);
}

class BoxOneEuroFilter {
  private readonly filters = Array.from({ length: 4 }, () => new OneEuroFilter(0.8, 0.02));

  reset(): void {
    this.filters.forEach((filter) => filter.reset());
  }

  filter(box: NormalizedBox, time: number): NormalizedBox {
    return {
      x: this.filters[0]!.filter(box.x, time),
      y: this.filters[1]!.filter(box.y, time),
      width: this.filters[2]!.filter(box.width, time),
      height: this.filters[3]!.filter(box.height, time),
    };
  }
}

const MAX_CAMERA_SPEED_PER_SEC = 0.50;
const MAX_CAMERA_ACCELERATION_PER_SEC2 = 1.5;

function averageCrop(crops: Array<{ crop: NormalizedBox; weight: number }>): NormalizedBox {
  const totalWeight = crops.reduce((sum, item) => sum + item.weight, 0);
  return {
    x: crops.reduce((sum, item) => sum + item.crop.x * item.weight, 0) / totalWeight,
    y: crops.reduce((sum, item) => sum + item.crop.y * item.weight, 0) / totalWeight,
    width: crops.reduce((sum, item) => sum + item.crop.width * item.weight, 0) / totalWeight,
    height: crops.reduce((sum, item) => sum + item.crop.height * item.weight, 0) / totalWeight,
  };
}

/** A strong 7-sample triangular denoiser that never reads another shot. */
function smoothWithinShots(samples: AutoFlipCropSample[]): AutoFlipCropSample[] {
  return samples.map((sample, index) => {
    const window: Array<{ crop: NormalizedBox; weight: number }> = [{ crop: sample.crop, weight: 4 }];
    for (const direction of [-1, 1] as const) {
      if (direction < 0 && sample.cut) continue;
      for (let distance = 1; distance <= 3; distance++) {
        const candidate = samples[index + direction * distance];
        // A `cut` sample starts a new shot, so it is a hard temporal boundary
        // in either direction of the filter window.
        if (!candidate || candidate.cut) break;
        window.push({ crop: candidate.crop, weight: 4 - distance });
      }
    }
    return { ...sample, crop: averageCrop(window) };
  });
}

function clampCameraMotion(
  previous: NormalizedBox,
  candidate: NormalizedBox,
  previousVelocity: { x: number; y: number },
  dt: number,
): { crop: NormalizedBox; velocity: { x: number; y: number } } {
  const safeDt = Math.max(1 / 120, dt);
  const previousCenter = { x: previous.x + previous.width / 2, y: previous.y + previous.height / 2 };
  const candidateCenter = { x: candidate.x + candidate.width / 2, y: candidate.y + candidate.height / 2 };
  const desiredVelocity = {
    x: (candidateCenter.x - previousCenter.x) / safeDt,
    y: (candidateCenter.y - previousCenter.y) / safeDt,
  };
  const maxVelocityDelta = MAX_CAMERA_ACCELERATION_PER_SEC2 * safeDt;
  const velocity = {
    x: Math.max(-MAX_CAMERA_SPEED_PER_SEC, Math.min(MAX_CAMERA_SPEED_PER_SEC,
      Math.max(previousVelocity.x - maxVelocityDelta, Math.min(previousVelocity.x + maxVelocityDelta, desiredVelocity.x)))),
    y: Math.max(-MAX_CAMERA_SPEED_PER_SEC, Math.min(MAX_CAMERA_SPEED_PER_SEC,
      Math.max(previousVelocity.y - maxVelocityDelta, Math.min(previousVelocity.y + maxVelocityDelta, desiredVelocity.y)))),
  };
  const x = Math.max(0, Math.min(1 - candidate.width, previousCenter.x + velocity.x * safeDt - candidate.width / 2));
  const y = Math.max(0, Math.min(1 - candidate.height, previousCenter.y + velocity.y * safeDt - candidate.height / 2));
  return { crop: { ...candidate, x, y }, velocity };
}

/** OneEuro smoothing inside shots; resets on scene cuts (handoff §5.5). */
export function smoothShotCropSamples(
  samples: AutoFlipCropSample[],
  sceneCuts: number[],
): AutoFlipCropSample[] {
  const filter = new BoxOneEuroFilter();
  let lastTime = -Infinity;
  let previousCrop: NormalizedBox | null = null;
  let previousVelocity = { x: 0, y: 0 };
  const kinematicallySmoothed = samples.map((sample, index) => {
    if (sceneCuts.some((cut) => cut > lastTime + EPSILON && cut <= sample.t + EPSILON)) {
      filter.reset();
      previousCrop = null;
      previousVelocity = { x: 0, y: 0 };
    }
    lastTime = sample.t;
    if (sample.cut) {
      filter.reset();
      previousCrop = null;
      previousVelocity = { x: 0, y: 0 };
      return sample;
    }
    const filtered = filter.filter(sample.crop, sample.t);
    if (!previousCrop) {
      previousCrop = filtered;
      return { ...sample, crop: filtered };
    }
    const limited = clampCameraMotion(previousCrop, filtered, previousVelocity, sample.t - (samples[index - 1]?.t ?? sample.t));
    previousCrop = limited.crop;
    previousVelocity = limited.velocity;
    return { ...sample, crop: limited.crop };
  });
  return smoothWithinShots(kinematicallySmoothed);
}

export { viewportArea };
