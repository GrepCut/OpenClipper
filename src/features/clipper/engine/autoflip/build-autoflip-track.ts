import type { ClipperHeadroom, ClipperSmoothingStrength } from "../../settings/settings";
import type { FaceBoxSample } from "../../shared/face-samples";
import type { AutoFlipAspectTrack, AutoFlipCropSample, AutoFlipSceneDebug, AutoFlipStaticFeatureSample, ClipperSmartCropBlob, NormalizedBox, SmartCropSample, SubjectDetectionSample } from "../../shared/smart-crop";
import type { CentroidSample } from "../reframe";
import { cropRectToCentroid } from "./frame-crop-region";
import { analyzeSceneMotion, computeSalienceZoomScale } from "./scene-camera-motion";
import { buildSceneTimeline, cropScenePath } from "./scene-cropper";
import { buildSalientKeyframes } from "./salient-region";
import { kinematicOptionsForSmoothing } from "./kinematic-options";
import { AUTOFLIP_ANALYZER_VERSION, AUTOFLIP_MATCHED_ASPECT_MIN_ZOOM_SCENE_SEC, AUTOFLIP_MAX_SCENE_FRAMES, AUTOFLIP_MIN_ZOOM_SCALE, AUTOFLIP_MIN_ZOOM_SCENE_SEC, AUTOFLIP_MODEL_ID, AUTOFLIP_ZOOM_MARGIN } from "./types";
import type { FocusPointFrame, KeyFrameSalientInput, SalientSignalType } from "./types";

export interface BuildAutoFlipTrackInput {
  clipStart: number;
  clipEnd: number;
  detections: SubjectDetectionSample[];
  faces: FaceBoxSample[];
  sceneCuts: number[];
  /** Legacy primary target.  New callers should supply `targetAspectRatios`. */
  targetAspectRatio?: number;
  /** Every enabled crop output gets its own camera path. */
  targetAspectRatios?: Record<string, number>;
  frameWidth?: number;
  frameHeight?: number;
  smoothing?: ClipperSmoothingStrength;
  /** Sizes the salience-driven zoom margin; defaults to "normal". */
  headroom?: ClipperHeadroom;
  /** Allow zooming when source and target aspects match (on by default). */
  matchedAspectZoom?: boolean;
  degradedReason?: string;
  hasSolidColorBackground?: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number };
  /** MediaPipe evaluates solid background independently for each scene. */
  staticFeatureSamples?: AutoFlipStaticFeatureSample[];
  /** Source-space active image area after static letterbox borders are removed. */
  contentRect?: NormalizedBox;
  /** Native decoded frame rate; used for graph-equivalent scene boundaries and paths. */
  sourceFrameRate?: number;
  trackerVersion?: "bytetrack-v1";
  /** Attach per-scene diagnostics to the returned blob (benchmark tooling only). */
  collectDebug?: boolean;
}

const FULL_FRAME: NormalizedBox = { x: 0, y: 0, width: 1, height: 1 };
const FOREGROUND_SIGNALS = new Set<SalientSignalType>(["face_core", "face_all", "face_full", "pose_head", "pose_torso", "human", "pet", "car"]);

function hasForegroundSalience(keyframes: KeyFrameSalientInput[]): boolean {
  return keyframes.some((keyframe) => keyframe.regions.some((region) => FOREGROUND_SIGNALS.has(region.signalType)));
}

function validContentRect(rect: NormalizedBox | undefined): NormalizedBox {
  if (!rect || rect.width <= 0 || rect.height <= 0) return FULL_FRAME;
  const x = Math.max(0, Math.min(1, rect.x));
  const y = Math.max(0, Math.min(1, rect.y));
  const width = Math.max(0, Math.min(1 - x, rect.width));
  const height = Math.max(0, Math.min(1 - y, rect.height));
  return width > 0 && height > 0 ? { x, y, width, height } : FULL_FRAME;
}

function intoContentRect(box: NormalizedBox, content: NormalizedBox): NormalizedBox | null {
  const left = Math.max(content.x, box.x);
  const top = Math.max(content.y, box.y);
  const right = Math.min(content.x + content.width, box.x + box.width);
  const bottom = Math.min(content.y + content.height, box.y + box.height);
  if (right <= left || bottom <= top) return null;
  return {
    x: (left - content.x) / content.width,
    y: (top - content.y) / content.height,
    width: (right - left) / content.width,
    height: (bottom - top) / content.height,
  };
}

function intoSourceRect(rect: NormalizedBox, content: NormalizedBox): NormalizedBox {
  return {
    x: content.x + rect.x * content.width,
    y: content.y + rect.y * content.height,
    width: rect.width * content.width,
    height: rect.height * content.height,
  };
}

function detectionsInContent(detections: SubjectDetectionSample[], content: NormalizedBox): SubjectDetectionSample[] {
  if (content === FULL_FRAME) return detections;
  return detections.map((sample) => ({
    ...sample,
    detections: sample.detections.flatMap((detection) => {
      const box = intoContentRect(detection.box, content);
      return box ? [{ ...detection, box }] : [];
    }),
    autoflipFaces: sample.autoflipFaces?.flatMap((face) => {
      const box = intoContentRect(face.box, content);
      if (!box) return [];
      return [{
        ...face,
        box,
        keypoints: face.keypoints.flatMap((point) =>
          point.x >= content.x && point.x <= content.x + content.width && point.y >= content.y && point.y <= content.y + content.height
            ? [{ x: (point.x - content.x) / content.width, y: (point.y - content.y) / content.height }]
            : [],
        ),
      }];
    }),
    poseSubjects: sample.poseSubjects?.flatMap((pose) => {
      const box = intoContentRect(pose.box, content);
      if (!box) return [];
      return [{
        ...pose,
        box,
        headBox: pose.headBox ? intoContentRect(pose.headBox, content) ?? undefined : undefined,
        torsoBox: pose.torsoBox ? intoContentRect(pose.torsoBox, content) ?? undefined : undefined,
      }];
    }),
  }));
}

function splitScenes(
  clipStart: number,
  clipEnd: number,
  sceneCuts: number[],
  sourceFrameRate: number,
): Array<{ start: number; end: number; cut: boolean; continueLastScene: boolean }> {
  const boundaries = [...new Set([clipStart, ...sceneCuts, clipEnd])]
    .filter((time) => time >= clipStart && time <= clipEnd)
    .sort((a, b) => a - b);
  const scenes: Array<{ start: number; end: number; cut: boolean; continueLastScene: boolean }> = [];
  for (let index = 1; index < boundaries.length; index++) {
    scenes.push({
      start: boundaries[index - 1]!,
      end: boundaries[index]!,
      cut: index > 1, continueLastScene: false,
    });
  }
  if (scenes.length === 0) scenes.push({ start: clipStart, end: clipEnd, cut: false, continueLastScene: false });

  const chunked: Array<{ start: number; end: number; cut: boolean; continueLastScene: boolean }> = [];
  for (const scene of scenes) {
    const maxSceneSec = AUTOFLIP_MAX_SCENE_FRAMES / sourceFrameRate;
    if (scene.end - scene.start <= maxSceneSec) {
      chunked.push(scene);
      continue;
    }
    for (let start = scene.start; start < scene.end - 1e-9; start += maxSceneSec) {
      chunked.push({
        start,
        end: Math.min(scene.end, start + maxSceneSec),
        cut: start === scene.start && scene.cut,
        continueLastScene: start > scene.start,
      });
    }
  }
  return chunked;
}

function rectToSample(time: number, rect: { x: number; y: number; width: number; height: number }, cut: boolean): SmartCropSample {
  const centroid = cropRectToCentroid(rect);
  return {
    t: time,
    x: centroid.x,
    y: centroid.y,
    extent: centroid.extent,
    targetId: "autoflip",
    kind: "person",
    score: 1,
    box: rect,
    cut: cut || undefined,
  };
}

export function buildAutoFlipTrack(input: BuildAutoFlipTrackInput): ClipperSmartCropBlob {
  const sourceFrameWidth = input.frameWidth ?? 1920;
  const sourceFrameHeight = input.frameHeight ?? 1080;
  const contentRect = validContentRect(input.contentRect);
  const frameWidth = sourceFrameWidth * contentRect.width;
  const frameHeight = sourceFrameHeight * contentRect.height;
  const sourceFrameRate = Number.isFinite(input.sourceFrameRate) && input.sourceFrameRate! > 0 ? input.sourceFrameRate! : 30;
  const kinematicOptions = kinematicOptionsForSmoothing(input.smoothing ?? "balanced");
  const scenes = splitScenes(input.clipStart, input.clipEnd, input.sceneCuts, sourceFrameRate);
  const keyframes = buildSalientKeyframes({
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    detections: detectionsInContent(input.detections, contentRect),
    sceneCuts: input.sceneCuts,
  });

  const targets = Object.keys(input.targetAspectRatios ?? {}).length
    ? input.targetAspectRatios!
    : { default: input.targetAspectRatio ?? 9 / 16 };
  const aspectTracks: Record<string, AutoFlipAspectTrack> = {};
  const debugScenes: AutoFlipSceneDebug[] | undefined = input.collectDebug ? [] : undefined;

  for (const [formatId, targetAspectRatio] of Object.entries(targets)) {
    const samples: AutoFlipCropSample[] = [];
    // One zoom scale per original scene (chunks of a forced split share it),
    // so a long take cannot pump between zoom levels.  When the source already
    // matches the target aspect, the classic full-frame passthrough wins
    // unless the caller opted in.
    const aspectMatchesSource = Math.abs(frameWidth / frameHeight - targetAspectRatio) < 0.001;
    const sceneZoom = new Array<number>(scenes.length).fill(1);
    if (!aspectMatchesSource || input.matchedAspectZoom !== false) {
      const margin = AUTOFLIP_ZOOM_MARGIN[input.headroom ?? "normal"];
      let index = 0;
      while (index < scenes.length) {
        let groupEnd = index + 1;
        while (groupEnd < scenes.length && scenes[groupEnd]!.continueLastScene) groupEnd++;
        const groupDuration = scenes[groupEnd - 1]!.end - scenes[index]!.start;
        const minZoomDuration = aspectMatchesSource ? AUTOFLIP_MATCHED_ASPECT_MIN_ZOOM_SCENE_SEC : AUTOFLIP_MIN_ZOOM_SCENE_SEC;
        if (groupDuration >= minZoomDuration) {
          const groupKeyframes = keyframes.filter(
            (keyframe) => keyframe.time >= scenes[index]!.start - 1e-9 && keyframe.time <= scenes[groupEnd - 1]!.end + 1e-9,
          );
          const scale = hasForegroundSalience(groupKeyframes) ? computeSalienceZoomScale({
            keyframes: groupKeyframes,
            frameWidth,
            frameHeight,
            targetAspectRatio,
            margin,
            minScale: AUTOFLIP_MIN_ZOOM_SCALE,
          }) : 1;
          for (let sceneIndex = index; sceneIndex < groupEnd; sceneIndex++) sceneZoom[sceneIndex] = scale;
        }
        index = groupEnd;
      }
    }
    // Product policy layered on top of AutoFlip: when BorderDetection found a
    // stable solid background, retaining the active image and padding it is
    // preferable to throwing away slide/gameplay content merely to fill a
    // vertical target. The renderer recognizes this non-matching aspect and
    // uses the graph-compatible solid-colour padding path.
    let continuationFocus: FocusPointFrame[] = [];
    for (const [sceneIndex, scene] of scenes.entries()) {
      const sceneKeyframes = keyframes.filter(
        (keyframe) => keyframe.time >= scene.start - 1e-9 && (keyframe.time < scene.end - 1e-9 || scene.end >= input.clipEnd - 1e-9),
      );
      const sceneBackground = solidBackgroundForScene(
        scene,
        input.staticFeatureSamples,
        input.hasSolidColorBackground,
        input.solidBackgroundColor,
      );
      const preserveContentWithPadding = sceneBackground.hasSolid
        && Math.abs(frameWidth / frameHeight - targetAspectRatio) > 0.001
        && !hasForegroundSalience(sceneKeyframes);
      if (preserveContentWithPadding) {
        const timeline = buildSceneTimeline(scene.start, scene.end, sourceFrameRate, scene.end >= input.clipEnd - 1e-9);
        timeline.timestampsUs.forEach((timestampUs, index) => {
          samples.push({
            t: timestampUs / 1_000_000,
            crop: contentRect,
            cut: index === 0 && scene.cut,
            solidBackgroundColor: sceneBackground.color,
          });
        });
        debugScenes?.push({
          formatId,
          start: scene.start,
          end: scene.end,
          motionType: "padding",
          lookAtCenterX: 0.5,
          lookAtCenterY: 0.5,
          cropWindowWidthNorm: 1,
          cropWindowHeightNorm: 1,
          keyframes: sceneKeyframes.map((keyframe) => ({
            time: keyframe.time,
            regions: keyframe.regions.map((region) => ({ box: region.box, score: region.score, signalType: region.signalType })),
            chosenRect: FULL_FRAME,
          })),
        });
        continue;
      }
      if (sceneKeyframes.length === 0) continue;
      const timeline = buildSceneTimeline(scene.start, scene.end, sourceFrameRate, scene.end >= input.clipEnd - 1e-9);
      const motion = analyzeSceneMotion({
        keyframes: sceneKeyframes,
        frameWidth,
        frameHeight,
        targetAspectRatio,
        hasSolidColorBackground: sceneBackground.hasSolid,
        sceneTimestampsUs: timeline.timestampsUs,
        cropScale: sceneZoom[sceneIndex],
      });
      const cropRects = cropScenePath({
        summary: motion.summary,
        focusPointFrames: motion.focusPointFrames,
        priorFocusPointFrames: scene.continueLastScene ? continuationFocus : [],
        sceneTimestampsUs: timeline.timestampsUs,
        isKeyFrames: timeline.isKeyFrames,
        kinematicOptions,
        continueLastScene: scene.continueLastScene,
        pathSolver: motion.summary.motionType === "tracking" ? "kinematic" : "polynomial",
      });
      cropRects.forEach((crop, index) => {
        samples.push({ t: timeline.timestampsUs[index]! / 1_000_000, crop: intoSourceRect(crop, contentRect), cut: index === 0 && scene.cut });
      });
      continuationFocus = motion.focusPointFrames.slice(-30);
      debugScenes?.push({
        formatId,
        start: scene.start,
        end: scene.end,
        motionType: motion.summary.motionType,
        lookAtCenterX: motion.summary.lookAtCenterX,
        lookAtCenterY: motion.summary.lookAtCenterY,
        cropWindowWidthNorm: motion.summary.cropWindowWidth / frameWidth,
        cropWindowHeightNorm: motion.summary.cropWindowHeight / frameHeight,
        successRate: motion.summary.frameSuccessRate,
        keyframes: sceneKeyframes.map((keyframe) => ({
          time: keyframe.time,
          regions: keyframe.regions.map((region) => ({ box: region.box, score: region.score, signalType: region.signalType })),
          chosenRect: motion.keyframeCrops.find((crop) => Math.abs(crop.time - keyframe.time) < 1e-9)?.rect,
        })),
      });
    }
    if (samples.length === 0) {
      const sourceAspect = frameWidth / frameHeight;
      const width = sourceAspect >= targetAspectRatio ? targetAspectRatio / sourceAspect : 1;
      const height = sourceAspect >= targetAspectRatio ? 1 : sourceAspect / targetAspectRatio;
      for (let time = input.clipStart; time <= input.clipEnd + 1e-9; time += 1 / sourceFrameRate) {
        samples.push({ t: time, crop: intoSourceRect({ x: (1 - width) / 2, y: (1 - height) / 2, width, height }, contentRect) });
      }
    }
    aspectTracks[formatId] = { targetAspectRatio, samples };
  }

  const primaryTrack = aspectTracks[Object.keys(aspectTracks)[0]!]!;
  const samples: SmartCropSample[] = primaryTrack.samples.map((sample) => rectToSample(sample.t, sample.crop, Boolean(sample.cut)));

  return {
    analyzerVersion: AUTOFLIP_ANALYZER_VERSION,
    modelId: AUTOFLIP_MODEL_ID,
    trackerVersion: input.trackerVersion,
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    targetAspectRatio: primaryTrack.targetAspectRatio,
    contentRect,
    solidBackgroundColor: input.hasSolidColorBackground ? input.solidBackgroundColor : undefined,
    degradedReason: input.degradedReason,
    samples,
    aspectTracks,
    debug: debugScenes,
  };
}

function solidBackgroundForScene(
  scene: { start: number; end: number },
  samples: AutoFlipStaticFeatureSample[] | undefined,
  legacyHasSolid: boolean | undefined,
  legacyColor: { r: number; g: number; b: number } | undefined,
): { hasSolid: boolean; color?: { r: number; g: number; b: number } } {
  const sceneSamples = (samples ?? []).filter((sample) =>
    sample.time >= scene.start - 1e-9 && sample.time < scene.end + 1e-9,
  );
  if (!sceneSamples.length) return { hasSolid: Boolean(legacyHasSolid), color: legacyColor };
  const solid = sceneSamples.filter((sample) => sample.hasSolidColorBackground);
  if (solid.length / sceneSamples.length < 0.6) return { hasSolid: false };
  const colors = solid.flatMap((sample) => sample.solidBackgroundColor ? [sample.solidBackgroundColor] : []);
  if (!colors.length) return { hasSolid: true };
  return {
    hasSolid: true,
    color: {
      r: Math.round(colors.reduce((sum, color) => sum + color.r, 0) / colors.length),
      g: Math.round(colors.reduce((sum, color) => sum + color.g, 0) / colors.length),
      b: Math.round(colors.reduce((sum, color) => sum + color.b, 0) / colors.length),
    },
  };
}

/** Finds the lossless render path for a format, including blobs made before v2. */
export function resolveAutoFlipCropTrack(blob: ClipperSmartCropBlob, formatId: string): AutoFlipAspectTrack | null {
  return blob.aspectTracks?.[formatId] ?? blob.aspectTracks?.default ?? null;
}

export function resolveAutoFlipDisplayTrack(
  blob: ClipperSmartCropBlob,
  _smoothing: ClipperSmoothingStrength,
): CentroidSample[] {
  return blob.samples.map(({ t, x, y, extent, cut }) => ({ t, x, y, extent, cut }));
}

export { AUTOFLIP_ANALYZER_VERSION, AUTOFLIP_MODEL_ID } from "./types";

export function primaryCropAspectRatio(enabledFormatIds: string[]): number {
  const preferred = enabledFormatIds.find((id) => id === "tiktok") ?? enabledFormatIds[0] ?? "tiktok";
  switch (preferred) {
    case "instagram":
    case "linkedin":
      return 1;
    case "instagram-portrait":
      return 4 / 5;
    case "youtube":
    case "twitter":
      return 16 / 9;
    case "tiktok":
    default:
      return 9 / 16;
  }
}
