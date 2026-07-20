import type { AutoFlipCropSample, NormalizedBox } from "../../shared/smart-crop";
import { OneEuroFilter } from "./one-euro-filter";

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

/** OneEuro smoothing inside shots; resets on scene cuts (handoff §5.5). */
export function smoothShotCropSamples(
  samples: AutoFlipCropSample[],
  sceneCuts: number[],
): AutoFlipCropSample[] {
  const filter = new BoxOneEuroFilter();
  let lastTime = -Infinity;
  return samples.map((sample) => {
    if (sceneCuts.some((cut) => cut > lastTime + EPSILON && cut <= sample.t + EPSILON)) {
      filter.reset();
    }
    lastTime = sample.t;
    if (sample.cut) {
      filter.reset();
      return sample;
    }
    return { ...sample, crop: filter.filter(sample.crop, sample.t) };
  });
}

export { viewportArea };
