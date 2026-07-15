import { VideoSampleSink } from "mediabunny";
import { createMediabunnyInput } from "../../lib/media/mediabunny-file-source";
import {
  type FaceBox,
  type FaceDetectorInitOptions,
  type FaceRotationDegrees,
  ToolFaceDetectorService,
} from "../../lib/media/face-detector";
import { detectFacesTiled } from '../../lib/media/face-detect-tiled';

import type { FaceBoxSample } from "../../shared/face-samples";
export type { FaceBoxSample };

/**
 * One decoded frame + everything `detectFacesTiled` needs, from either the
 * live `<video>` element (preview) or an already-decoded `VideoFrame`
 * (render/parallel detection). `release()` must be called exactly once after
 * the detect call resolves or rejects.
 */
export interface FaceDetectFrameSource {
  frame: VideoFrame;
  bitmap?: ImageBitmap;
  rotationDegrees: FaceRotationDegrees;
  release(): void;
}

/**
 * Thrown only for a broken detector setup (e.g. WASM/model init failure) —
 * distinguished from a single bad frame, which should just be retried later.
 */
export class DetectorUnavailableError extends Error {}

export async function detectFaceSampleAt(
  time: number,
  detector: ToolFaceDetectorService,
  detectorOptions: FaceDetectorInitOptions,
  source: FaceDetectFrameSource,
): Promise<FaceBoxSample> {
  try {
    try {
      await detector.initialize(detectorOptions);
    } catch (error) {
      throw new DetectorUnavailableError(String(error));
    }
    const faces = await detectFacesTiled(source.frame, detector, time, source.rotationDegrees, source.bitmap);
    return { time, faces, frameW: source.frame.displayWidth, frameH: source.frame.displayHeight };
  } finally {
    source.release();
  }
}

export interface DetectFaceSegmentParams {
  file: File;
  startTime: number;
  endTime: number;
  intervalSec: number;
  detector: ToolFaceDetectorService;
  detectorOptions: FaceDetectorInitOptions;
  signal?: AbortSignal;
  onSample: (sample: FaceBoxSample) => void;
  /** 0..1 within this segment only — the caller is responsible for weighting across segments. */
  onProgress?: (ratioWithinSegment: number) => void;
}

/**
 * Decodes `[startTime, endTime)` from `file` at `intervalSec` spacing and runs
 * face detection on each sample, reporting results via `onSample` as they
 * resolve. This is the single source of truth for "decode + detect over a
 * time range" — the sequential (main-thread) fallback calls it once for the
 * whole clip, and each parallel detection worker
 * (`clipper-face-detect.worker.ts`) calls it once for its own time-slice.
 *
 * A single bad frame (transient decode/detect glitch) is skipped, not fatal —
 * the loop keeps going. Only `DetectorUnavailableError` (broken WASM/model
 * init) propagates out, since that means every subsequent sample would fail
 * the same way.
 */
export async function detectFaceSegment(params: DetectFaceSegmentParams): Promise<void> {
  const { file, startTime, endTime, intervalSec, detector, detectorOptions, signal, onSample, onProgress } = params;
  const input = await createMediabunnyInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return;
    const sink = new VideoSampleSink(videoTrack);
    const segmentDuration = endTime - startTime;

    for (let t = startTime; t < endTime; t += intervalSec) {
      if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");

      const sample = await sink.getSample(t);
      if (!sample) continue;

      try {
        const frame = sample.toVideoFrame();
        let bitmap: ImageBitmap | undefined;
        try {
          bitmap = await createImageBitmap(frame);
        } catch {
          bitmap = undefined;
        }
        const source: FaceDetectFrameSource = {
          frame,
          bitmap,
          rotationDegrees: (sample.rotation as FaceRotationDegrees) ?? 0,
          release: () => {
            bitmap?.close();
            frame.close();
          },
        };

        try {
          const result = await detectFaceSampleAt(sample.timestamp, detector, detectorOptions, source);
          onSample(result);
        } catch (error) {
          if (error instanceof DetectorUnavailableError) throw error;
          // Transient per-sample failure — leave this bucket unset and keep going.
        }
      } finally {
        sample.close();
      }

      onProgress?.(segmentDuration > 0 ? Math.min(1, (t - startTime) / segmentDuration) : 1);
    }

    onProgress?.(1);
  } finally {
    input.dispose();
  }
}
