import type { KinematicOptions } from "./types";
import { DEFAULT_KINEMATIC_OPTIONS } from "./types";

const MIN_VELOCITY = 0.5;

export class KinematicPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KinematicPathError";
  }
}

function medianPosition(positions: Array<[number, number]>): number {
  const values = positions.map(([, position]) => position);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class KinematicPathSolver {
  private readonly options: KinematicOptions;
  private minLocation: number;
  private maxLocation: number;
  private pixelsPerDegree: number;
  private initialized = false;
  private currentPositionPx = 0;
  private priorPositionPx = 0;
  private targetPositionPx = 0;
  private currentTimeUs = 0;
  private currentVelocityDegPerS = 0;
  private meanDeltaT = -1;
  private motionState = false;
  private rawPositionsAtTime: Array<[number, number]> = [];

  constructor(
    options: KinematicOptions,
    minLocation: number,
    maxLocation: number,
    pixelsPerDegree: number,
  ) {
    this.options = { ...DEFAULT_KINEMATIC_OPTIONS, ...options };
    this.minLocation = minLocation;
    this.maxLocation = maxLocation;
    this.pixelsPerDegree = pixelsPerDegree;
  }

  private validateOptions(): void {
    if (this.pixelsPerDegree <= 0) throw new KinematicPathError("pixels_per_degree must be larger than 0.");
    const updateRateSeconds = this.options.updateRateSeconds ?? DEFAULT_KINEMATIC_OPTIONS.updateRateSeconds;
    const filteringTimeWindowUs = this.options.filteringTimeWindowUs ?? DEFAULT_KINEMATIC_OPTIONS.filteringTimeWindowUs;
    const meanPeriodUpdateRate = this.options.meanPeriodUpdateRate ?? DEFAULT_KINEMATIC_OPTIONS.meanPeriodUpdateRate;
    if (updateRateSeconds < 0) throw new KinematicPathError("update_rate_seconds must be greater than 0.");
    if (filteringTimeWindowUs < 0) throw new KinematicPathError("filtering_time_window_us must be greater than 0.");
    if (meanPeriodUpdateRate < 0) throw new KinematicPathError("mean_period_update_rate must be greater than 0.");

    const hasUnifiedMin = this.options.minMotionToReframe != null;
    const hasSplitMin =
      this.options.minMotionToReframeLower != null && this.options.minMotionToReframeUpper != null;
    if (hasUnifiedMin === hasSplitMin) {
      throw new KinematicPathError(
        "Must set min_motion_to_reframe or min_motion_to_reframe_upper and min_motion_to_reframe_lower.",
      );
    }

    const reframeWindow = this.options.reframeWindow ?? DEFAULT_KINEMATIC_OPTIONS.reframeWindow;
    const minReframe = hasUnifiedMin
      ? this.options.minMotionToReframe!
      : Math.min(this.options.minMotionToReframeLower!, this.options.minMotionToReframeUpper!);
    if (reframeWindow > minReframe) {
      throw new KinematicPathError("Reframe window cannot exceed min_motion_to_reframe.");
    }

    const hasMaxVelocity = this.options.maxVelocity != null;
    const hasScaledMax =
      this.options.maxVelocityScale != null && this.options.maxVelocityShift != null;
    if (hasMaxVelocity === hasScaledMax) {
      throw new KinematicPathError(
        "Must either set max_velocity or set both max_velocity_scale and max_velocity_shift.",
      );
    }
  }

  private isMotionTooSmall(deltaDegs: number): boolean {
    if (this.options.minMotionToReframe != null) {
      return Math.abs(deltaDegs) < this.options.minMotionToReframe;
    }
    if (deltaDegs > 0) {
      return deltaDegs < this.options.minMotionToReframeUpper!;
    }
    return Math.abs(deltaDegs) < this.options.minMotionToReframeLower!;
  }

  private trimHistory(timeUs: number): void {
    const filteringTimeWindowUs = this.options.filteringTimeWindowUs ?? DEFAULT_KINEMATIC_OPTIONS.filteringTimeWindowUs;
    while (this.rawPositionsAtTime.length > 1) {
      if (this.rawPositionsAtTime.at(-1)![0] < timeUs - filteringTimeWindowUs) {
        this.rawPositionsAtTime.pop();
      } else {
        break;
      }
    }
  }

  predictMotionState(position: number, timeUs: number): boolean {
    if (!this.initialized) return false;

    const history: Array<[number, number]> = [[timeUs, position], ...this.rawPositionsAtTime];
    const filteringTimeWindowUs = this.options.filteringTimeWindowUs ?? DEFAULT_KINEMATIC_OPTIONS.filteringTimeWindowUs;
    while (history.length > 1 && history.at(-1)![0] < timeUs - filteringTimeWindowUs) {
      history.pop();
    }

    let filteredPosition = clamp(medianPosition(history), this.minLocation, this.maxLocation);
    const deltaDegs = (filteredPosition - this.currentPositionPx) / this.pixelsPerDegree;
    const reframeWindow = this.options.reframeWindow ?? DEFAULT_KINEMATIC_OPTIONS.reframeWindow;

    if (this.isMotionTooSmall(deltaDegs) && !this.motionState) return false;
    if (Math.abs(deltaDegs) < reframeWindow && this.motionState) return false;
    if (this.priorPositionPx === this.currentPositionPx && this.motionState) return false;
    return true;
  }

  addObservation(position: number, timeUs: number): void {
    if (!this.initialized) {
      this.currentPositionPx = clamp(position, this.minLocation, this.maxLocation);
      this.targetPositionPx = position;
      this.priorPositionPx = this.currentPositionPx;
      this.motionState = false;
      this.meanDeltaT = -1;
      this.rawPositionsAtTime = [[timeUs, position]];
      this.currentTimeUs = timeUs;
      this.initialized = true;
      this.currentVelocityDegPerS = 0;
      this.validateOptions();
      return;
    }

    if (this.currentTimeUs >= timeUs) {
      throw new KinematicPathError("Observation added before a prior observation.");
    }

    this.rawPositionsAtTime.unshift([timeUs, position]);
    this.trimHistory(timeUs);

    let filteredPosition = medianPosition(this.rawPositionsAtTime);
    const minReframePx =
      (this.options.minMotionToReframe ??
        this.options.minMotionToReframeLower!) * this.pixelsPerDegree;
    const maxReframePx =
      (this.options.minMotionToReframe ??
        this.options.minMotionToReframeUpper!) * this.pixelsPerDegree;
    filteredPosition = Math.max(this.minLocation - minReframePx, filteredPosition);
    filteredPosition = Math.min(this.maxLocation + maxReframePx, filteredPosition);

    let deltaDegs = (filteredPosition - this.currentPositionPx) / this.pixelsPerDegree;
    const reframeWindow = this.options.reframeWindow ?? DEFAULT_KINEMATIC_OPTIONS.reframeWindow;
    const maxVelocity = this.resolveMaxVelocity(deltaDegs);

    if (this.isMotionTooSmall(deltaDegs) && !this.motionState) {
      deltaDegs = 0;
      this.motionState = false;
    } else if (Math.abs(deltaDegs) < reframeWindow && this.motionState) {
      deltaDegs = 0;
      this.motionState = false;
    } else if (deltaDegs > 0) {
      this.targetPositionPx = filteredPosition - this.pixelsPerDegree * reframeWindow;
      deltaDegs = (this.targetPositionPx - this.currentPositionPx) / this.pixelsPerDegree;
      this.motionState = true;
    } else {
      this.targetPositionPx = filteredPosition + this.pixelsPerDegree * reframeWindow;
      deltaDegs = (this.targetPositionPx - this.currentPositionPx) / this.pixelsPerDegree;
      this.motionState = true;
    }

    let deltaTSec = (timeUs - this.currentTimeUs) / 1_000_000;
    const maxDeltaTimeSec = this.options.maxDeltaTimeSec ?? DEFAULT_KINEMATIC_OPTIONS.maxDeltaTimeSec;
    if (maxDeltaTimeSec > 0) deltaTSec = Math.min(deltaTSec, maxDeltaTimeSec);

    const meanPeriodUpdateRate = this.options.meanPeriodUpdateRate ?? DEFAULT_KINEMATIC_OPTIONS.meanPeriodUpdateRate;
    if (this.meanDeltaT < 0) {
      this.meanDeltaT = deltaTSec;
    } else {
      this.meanDeltaT = this.meanDeltaT * (1 - meanPeriodUpdateRate) + deltaTSec * meanPeriodUpdateRate;
    }

    const observedVelocity = deltaDegs / deltaTSec;
    const updateRateSeconds = this.options.updateRateSeconds ?? DEFAULT_KINEMATIC_OPTIONS.updateRateSeconds;
    const maxUpdateRate = this.options.maxUpdateRate ?? DEFAULT_KINEMATIC_OPTIONS.maxUpdateRate;
    const updateRate = Math.min(this.meanDeltaT / updateRateSeconds, maxUpdateRate);
    const updatedVelocity =
      this.currentVelocityDegPerS * (1 - updateRate) + observedVelocity * updateRate;
    this.currentVelocityDegPerS =
      updatedVelocity > 0
        ? Math.min(updatedVelocity, maxVelocity)
        : Math.max(updatedVelocity, -maxVelocity);

    this.updatePrediction(timeUs);
  }

  updatePrediction(timeUs: number): void {
    if (!this.initialized) throw new KinematicPathError("Prediction before first observation.");
    if (this.currentTimeUs >= timeUs) {
      throw new KinematicPathError("Prediction time added before a prior observation or prediction.");
    }

    this.priorPositionPx = this.currentPositionPx;
    const updatePositionPx =
      this.currentPositionPx + this.currentVelocityDegPerS * this.meanDeltaT * this.pixelsPerDegree;

    if (updatePositionPx < this.minLocation) {
      this.currentPositionPx = this.minLocation;
      this.currentVelocityDegPerS = 0;
      this.motionState = false;
    } else if (updatePositionPx > this.maxLocation) {
      this.currentPositionPx = this.maxLocation;
      this.currentVelocityDegPerS = 0;
      this.motionState = false;
    } else {
      this.currentPositionPx = updatePositionPx;
    }
    this.currentTimeUs = timeUs;
  }

  getState(): number {
    if (!this.initialized) throw new KinematicPathError("GetState called before first observation added.");
    return this.currentPositionPx;
  }

  getStateInt(): number {
    return Math.round(this.getState());
  }

  getTargetPosition(): number {
    if (!this.initialized) throw new KinematicPathError("GetTargetPosition called before first observation added.");
    return Math.round(clamp(this.targetPositionPx, this.minLocation, this.maxLocation));
  }

  setState(position: number): void {
    if (!this.initialized) throw new KinematicPathError("SetState called before first observation added.");
    this.currentPositionPx = clamp(position, this.minLocation, this.maxLocation);
  }

  updatePixelsPerDegree(pixelsPerDegree: number): void {
    if (pixelsPerDegree <= 0) throw new KinematicPathError("pixels_per_degree must be larger than 0.");
    this.pixelsPerDegree = pixelsPerDegree;
  }

  updateMinMaxLocation(minLocation: number, maxLocation: number): void {
    if (!this.initialized) {
      this.minLocation = minLocation;
      this.maxLocation = maxLocation;
      return;
    }
    const priorDistance = this.maxLocation - this.minLocation;
    const updatedDistance = maxLocation - minLocation;
    const scaleChange = updatedDistance / priorDistance;
    this.currentPositionPx *= scaleChange;
    this.priorPositionPx *= scaleChange;
    this.targetPositionPx *= scaleChange;
    this.rawPositionsAtTime = this.rawPositionsAtTime.map(
      ([time, position]) => [time, position * scaleChange] as [number, number],
    );
    this.minLocation = minLocation;
    this.maxLocation = maxLocation;
  }

  private resolveMaxVelocity(deltaDegs: number): number {
    if (this.options.maxVelocity != null) return this.options.maxVelocity;
    return Math.max(
      Math.abs(deltaDegs * this.options.maxVelocityScale!) + this.options.maxVelocityShift!,
      MIN_VELOCITY,
    );
  }
}
