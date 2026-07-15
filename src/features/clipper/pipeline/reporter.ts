import type { ClipperStage } from "../shared/stages";

/** Progress/stage reporting seam — implemented by the hook via setState. */
export interface PipelineReporter {
  stage(stage: ClipperStage, message?: string): void;
  stageProgress(ratio: number | null): void;
  faceProgress(ratio: number | null): void;
  subjectProgress(ratio: number | null): void;
  /** Smoothed seconds-remaining estimate for the active native extraction; `null` when unknown/not applicable. */
  eta(seconds: number | null): void;
  faces(hasDetectedFaces: boolean, hasTwoSpeakers: boolean, sampleRevision: number): void;
  renderProgress(formatId: string, ratio: number | null): void;
}
