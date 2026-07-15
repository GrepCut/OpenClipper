export const CLIPPER_FACE_ACTION_BENCHMARK_FILE = "face_action_benchmark.txt";

export class FaceActionBenchmark {
  private readonly startedAt = performance.now();
  private currentPhase: string | null = null;
  private currentPhaseStarted = 0;
  private readonly phases = new Map<string, number>();
  private readonly meta: Record<string, string | number | boolean | null> = {};
  private nativeMetrics: Record<string, unknown> | null = null;

  setMeta(key: string, value: string | number | boolean | null): void {
    this.meta[key] = value;
  }

  setNativeMetrics(metrics: Record<string, unknown> | null | undefined): void {
    this.nativeMetrics = metrics ?? null;
  }

  enterPhase(phase: string): void {
    if (this.currentPhase === phase) return;
    this.closeCurrentPhase();
    this.currentPhase = phase;
    this.currentPhaseStarted = performance.now();
  }

  /** Adds wall time for a one-shot sub-step without switching the active phase. */
  addPhase(name: string, durationMs: number): void {
    this.phases.set(name, (this.phases.get(name) ?? 0) + durationMs);
  }

  finish(): void {
    this.closeCurrentPhase();
  }

  totalMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  toTxt(): string {
    this.finish();
    const lines: string[] = [
      "Face & Action Benchmark",
      `generatedAt: ${new Date().toISOString()}`,
      `totalMs: ${this.totalMs()}`,
    ];

    for (const [key, value] of Object.entries(this.meta)) {
      lines.push(`${key}: ${value}`);
    }

    lines.push("", "phasesMs:");
    for (const [phase, ms] of [...this.phases.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${phase}: ${Math.round(ms)}`);
    }

    if (this.nativeMetrics) {
      lines.push("", "nativeMetrics:");
      for (const [key, value] of Object.entries(this.nativeMetrics).sort((a, b) => a[0].localeCompare(b[0]))) {
        lines.push(`  ${key}: ${value}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  private closeCurrentPhase(): void {
    if (!this.currentPhase) return;
    const elapsed = performance.now() - this.currentPhaseStarted;
    this.phases.set(this.currentPhase, (this.phases.get(this.currentPhase) ?? 0) + elapsed);
    this.currentPhase = null;
  }
}
