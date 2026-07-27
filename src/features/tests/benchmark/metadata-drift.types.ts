import type { ClipperLayoutMode } from "../../clipper/shared/smart-crop.util";

export interface CropPanelSnapshot {
  source: { x: number; y: number; width: number; height: number };
  destination: { x: number; y: number; width: number; height: number };
}

export interface FrameMeta {
  timestampUs: number;
  layoutMode: ClipperLayoutMode;
  panels: CropPanelSnapshot[];
}

export interface ClipDriftSummary {
  clipId: string;
  aspectId: string;
  matchesBaseline: boolean;
  mse: number | null;
  maxFrameMse: number | null;
  changedFrameCount: number;
  structuralMismatchCount: number;
  comparedFrames: number;
}

export interface DriftSummary {
  baselineRunId: string;
  matchesBaseline: boolean;
  mse: number | null;
  maxFrameMse: number | null;
  changedFrameCount: number;
  structuralMismatchCount: number;
  comparedFrames: number;
  perClip: ClipDriftSummary[];
}
