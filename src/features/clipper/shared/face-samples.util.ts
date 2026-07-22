/** Pixel-space face bounding box from native WinML BlazeFace. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  engine?: "winml";
  modelVersion?: string;
  clipStart: number;
  clipEnd: number;
  samples: FaceBoxSample[];
}
