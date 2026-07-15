/**
 * Multi-pass face detection: full-frame + 2x2 overlapping tiles + ROI refine.
 * Supports container rotation via MediaPipe and adaptive orientation fallback.
 */
import {
  type FaceBox,
  type FaceRotationDegrees,
  ToolFaceDetectorService,
} from './face-detector';
import { DETECT_MAX_SIDE, faceIou, filterFaceBoxes } from "./face-detect-utils";

const TILE_MIN_SIDE = 480;
const TILE_OVERLAP = 0.2;
const NMS_IOU = 0.4;
const ROI_SCALE = 1.5;
const ROI_MAX_SIDE = 512;
const ORIENTATION_FALLBACK_DELTAS = [90, 180, 270] as const;
/** Skip 2x2 tiles when full-frame already found a face covering this fraction of the frame. */
const SKIP_TILES_MIN_FACE_AREA_FRAC = 0.001;

export interface LegacyFaceInferenceMetrics {
  fullFrameCalls: number;
  tileCalls: number;
  roiRefineCalls: number;
  rotationCalls: number;
}

let legacyMetrics: LegacyFaceInferenceMetrics = { fullFrameCalls: 0, tileCalls: 0, roiRefineCalls: 0, rotationCalls: 0 };

export function resetLegacyFaceInferenceMetrics(): void {
  legacyMetrics = { fullFrameCalls: 0, tileCalls: 0, roiRefineCalls: 0, rotationCalls: 0 };
}

export function snapshotLegacyFaceInferenceMetrics(): LegacyFaceInferenceMetrics {
  return { ...legacyMetrics };
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectFrameSource {
  frameW: number;
  frameH: number;
  frame?: VideoFrame;
  bitmap?: ImageBitmap;
}

function frameCodedSize(frame: VideoFrame): { w: number; h: number } {
  return { w: frame.codedWidth, h: frame.codedHeight };
}

function combineRotation(
  base: FaceRotationDegrees,
  delta: number,
): FaceRotationDegrees {
  const combined = (((base + delta) % 360) + 360) % 360;
  if (combined === 90 || combined === 180 || combined === 270) return combined;
  return 0;
}

function shouldSkipTiles(fullPass: FaceBox[], frameW: number, frameH: number): boolean {
  if (fullPass.length === 0) return false;
  const frameArea = frameW * frameH;
  if (frameArea <= 0) return false;
  const largestArea = Math.max(...fullPass.map((f) => f.width * f.height));
  return largestArea / frameArea >= SKIP_TILES_MIN_FACE_AREA_FRAC;
}

async function createRegionBitmap(
  source: DetectFrameSource,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  sw: number,
  sh: number,
): Promise<ImageBitmap> {
  if (source.bitmap) {
    return createImageBitmap(source.bitmap, rx, ry, rw, rh, {
      resizeWidth: sw,
      resizeHeight: sh,
    });
  }
  if (!source.frame) {
    throw new Error("DetectFrameSource requires frame or bitmap.");
  }
  return createImageBitmap(source.frame, rx, ry, rw, rh, {
    resizeWidth: sw,
    resizeHeight: sh,
  });
}

export async function detectFacesInRegion(
  source: DetectFrameSource,
  detector: ToolFaceDetectorService,
  region: Region,
  maxSide: number,
  rotationDegrees: FaceRotationDegrees = 0,
): Promise<FaceBox[]> {
  const frameW = source.frameW;
  const frameH = source.frameH;
  const rx = Math.max(0, Math.floor(region.x));
  const ry = Math.max(0, Math.floor(region.y));
  const cropRight = Math.min(frameW, Math.ceil(region.x + region.width));
  const cropBottom = Math.min(frameH, Math.ceil(region.y + region.height));
  const rw = cropRight - rx;
  const rh = cropBottom - ry;
  if (rw <= 0 || rh <= 0) return [];

  const scale = Math.min(maxSide / rw, maxSide / rh, 1);
  const sw = Math.max(1, Math.round(rw * scale));
  const sh = Math.max(1, Math.round(rh * scale));

  const bitmap = await createRegionBitmap(source, rx, ry, rw, rh, sw, sh);
  try {
    const local = await detector.detectImage(bitmap, rotationDegrees);
    const inv = 1 / scale;
    const scaled = local.map((f) => ({
      x: rx + f.x * inv,
      y: ry + f.y * inv,
      width: f.width * inv,
      height: f.height * inv,
    }));
    return filterFaceBoxes(scaled);
  } finally {
    bitmap.close();
  }
}

function boxArea(box: FaceBox): number {
  return box.width * box.height;
}

export function mergeFaceBoxesNms(faces: FaceBox[], iouThreshold = NMS_IOU): FaceBox[] {
  const sorted = [...faces].sort((a, b) => boxArea(b) - boxArea(a));
  const kept: FaceBox[] = [];

  for (const box of sorted) {
    if (kept.some((k) => faceIou(k, box) >= iouThreshold)) continue;
    kept.push(box);
  }
  return kept;
}

function computeTiles(w: number, h: number): Region[] {
  const cols = 2;
  const rows = 2;
  const tileW = (w / cols) * (1 + TILE_OVERLAP);
  const tileH = (h / rows) * (1 + TILE_OVERLAP);
  const stepX = w / cols;
  const stepY = h / rows;
  const insetX = (TILE_OVERLAP * stepX) / 2;
  const insetY = (TILE_OVERLAP * stepY) / 2;

  const tiles: Region[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        x: col * stepX - insetX,
        y: row * stepY - insetY,
        width: tileW,
        height: tileH,
      });
    }
  }
  return tiles;
}

async function refineFaceBox(
  source: DetectFrameSource,
  detector: ToolFaceDetectorService,
  box: FaceBox,
  rotationDegrees: FaceRotationDegrees,
): Promise<FaceBox> {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rw = box.width * ROI_SCALE;
  const rh = box.height * ROI_SCALE;
  const region: Region = { x: cx - rw / 2, y: cy - rh / 2, width: rw, height: rh };
  const refined = await detectFacesInRegion(
    source,
    detector,
    region,
    ROI_MAX_SIDE,
    rotationDegrees,
  );
  if (refined.length === 0) return box;

  let best = refined[0];
  let bestIou = faceIou(box, best);
  for (let i = 1; i < refined.length; i++) {
    const overlap = faceIou(box, refined[i]);
    if (overlap > bestIou) {
      bestIou = overlap;
      best = refined[i];
    }
  }
  return bestIou >= 0.1 ? best : box;
}

async function detectFullFrameOnly(
  source: DetectFrameSource,
  detector: ToolFaceDetectorService,
  rotationDegrees: FaceRotationDegrees,
): Promise<FaceBox[]> {
  legacyMetrics.fullFrameCalls++;
  const { frameW: w, frameH: h } = source;
  return detectFacesInRegion(
    source,
    detector,
    { x: 0, y: 0, width: w, height: h },
    DETECT_MAX_SIDE,
    rotationDegrees,
  );
}

function toDetectSource(
  frame: VideoFrame,
  bitmap?: ImageBitmap,
): DetectFrameSource {
  const { w, h } = frameCodedSize(frame);
  return { frameW: w, frameH: h, frame, bitmap };
}

/** Full-frame pass, optional 2x2 tiles, NMS merge, and ROI refine at a single orientation. */
export async function detectFacesTiledAtRotation(
  frame: VideoFrame,
  detector: ToolFaceDetectorService,
  _timestampSec: number,
  rotationDegrees: FaceRotationDegrees = 0,
  frameBitmap?: ImageBitmap,
): Promise<FaceBox[]> {
  const source = toDetectSource(frame, frameBitmap);
  const { frameW: w, frameH: h } = source;
  const fullRegion: Region = { x: 0, y: 0, width: w, height: h };

  const fullPass = await detectFacesInRegion(
    source,
    detector,
    fullRegion,
    DETECT_MAX_SIDE,
    rotationDegrees,
  );
  legacyMetrics.fullFrameCalls++;

  const tilePasses = shouldSkipTiles(fullPass, w, h)
    ? []
    : await Promise.all(
        computeTiles(w, h).map((tile) =>
          detectFacesInRegion(source, detector, tile, TILE_MIN_SIDE, rotationDegrees),
        ),
      );
  legacyMetrics.tileCalls += tilePasses.length;

  const merged = mergeFaceBoxesNms([...fullPass, ...tilePasses.flat()]);
  if (merged.length === 0) return [];

  const refined = await Promise.all(
    merged.map((box) => refineFaceBox(source, detector, box, rotationDegrees)),
  );
  legacyMetrics.roiRefineCalls += merged.length;
  return mergeFaceBoxesNms(refined);
}

/**
 * Tiled detection with container rotation; when the primary pass finds nothing,
 * tries full-frame passes at +90°, +180°, and +270°.
 */
export async function detectFacesTiled(
  frame: VideoFrame,
  detector: ToolFaceDetectorService,
  timestampSec: number,
  rotationDegrees: FaceRotationDegrees = 0,
  frameBitmap?: ImageBitmap,
): Promise<FaceBox[]> {
  const primary = await detectFacesTiledAtRotation(
    frame,
    detector,
    timestampSec,
    rotationDegrees,
    frameBitmap,
  );
  if (primary.length > 0) return primary;

  const source = toDetectSource(frame, frameBitmap);
  for (const delta of ORIENTATION_FALLBACK_DELTAS) {
    legacyMetrics.rotationCalls++;
    const rot = combineRotation(rotationDegrees, delta);
    const faces = await detectFullFrameOnly(source, detector, rot);
    if (faces.length > 0) return faces;
  }
  return [];
}
