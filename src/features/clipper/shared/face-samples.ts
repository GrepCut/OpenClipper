import type { FaceBox } from "../lib/media/face-detector";

/** One detection pass at a sampled timestamp. */
export interface FaceBoxSample {
  time: number;
  faces: FaceBox[];
  frameW: number;
  frameH: number;
  /** True when a hard cut (scene change) was detected immediately before this sample — the camera-follow track should teleport here instead of easing across it. */
  sceneCut?: boolean;
}

export interface ClipperFaceSamplesBlob {
  detectorVersion: string;
  /** Runtime provenance is separate from the model/policy signature. */
  engine?: "winml" | "wasm";
  modelVersion?: string;
  clipStart: number;
  clipEnd: number;
  samples: FaceBoxSample[];
}
