const DEFAULT_FREQUENCY = 30;
const DEFAULT_MIN_CUTOFF = 2.5;
const DEFAULT_BETA = 300;
const DEFAULT_DERIVATIVE_CUTOFF = 2.5;

function smoothingFactor(deltaSeconds: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(Number.EPSILON, cutoff));
  return 1 / (1 + tau / Math.max(Number.EPSILON, deltaSeconds));
}

function lowPass(alpha: number, value: number, previous: number): number {
  return alpha * value + (1 - alpha) * previous;
}

/** Timestamp-aware adaptive low-pass filter using MoveNet's reference defaults. */
export class OneEuroFilter {
  private previousTime: number | null = null;
  private previousValue: number | null = null;
  private previousDerivative = 0;

  constructor(
    private readonly minCutoff = DEFAULT_MIN_CUTOFF,
    private readonly beta = DEFAULT_BETA,
    private readonly derivativeCutoff = DEFAULT_DERIVATIVE_CUTOFF,
  ) {}

  reset(): void {
    this.previousTime = null;
    this.previousValue = null;
    this.previousDerivative = 0;
  }

  filter(value: number, timeSeconds: number): number {
    if (this.previousTime == null || this.previousValue == null || timeSeconds <= this.previousTime) {
      this.previousTime = timeSeconds;
      this.previousValue = value;
      this.previousDerivative = 0;
      return value;
    }
    const delta = timeSeconds - this.previousTime;
    const frequency = delta > 0 ? 1 / delta : DEFAULT_FREQUENCY;
    const derivative = (value - this.previousValue) * frequency;
    const derivativeAlpha = smoothingFactor(delta, this.derivativeCutoff);
    const filteredDerivative = lowPass(derivativeAlpha, derivative, this.previousDerivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    const filtered = lowPass(smoothingFactor(delta, cutoff), value, this.previousValue);
    this.previousTime = timeSeconds;
    this.previousValue = filtered;
    this.previousDerivative = filteredDerivative;
    return filtered;
  }
}
