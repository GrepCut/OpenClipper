import type { ClipperLayoutMode } from "../../clipper/shared/smart-crop.util";

export interface FrameMeta {
  timestampUs: number;
  layoutMode: ClipperLayoutMode;
  viewports: Array<{ x: number; y: number; width: number; height: number }>;
  reasonCodes?: string[];
}

export interface ClipDriftSummary {
  clipId: string;
  aspectId: string;
  matchPct: number;
  driftPct: number;
  matchingFrames: number;
  comparedFrames: number;
}

export interface DriftSummary {
  baselineRunId: string;
  primaryAspectId: string;
  matchPct: number;
  driftPct: number;
  matchingFrames: number;
  comparedFrames: number;
  perClip: ClipDriftSummary[];
}
