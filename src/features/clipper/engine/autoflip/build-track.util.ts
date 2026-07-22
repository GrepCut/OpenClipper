import type { ClipperHeadroom, ClipperSmoothingStrength } from "../../settings/settings.util";
import type { FaceBoxSample } from "../../shared/face-samples.util";
import type { AutoFlipAspectTrack, AutoFlipCropSample, AutoFlipSceneDebug, AutoFlipStaticFeatureSample, ClipperSmartCropBlob, ImportanceSignalSample, NormalizedBox, SubjectDetectionSample } from "../../shared/smart-crop.util";
import { analyzeSceneMotion } from "./camera/scene-motion.util";
import { buildSceneTimeline, cropScenePath } from "./camera/scene-path.util";
import { buildSalientKeyframes } from "./salience/salient-region.util";
import { attachImportanceSignals, buildImportanceTimeline } from "./salience/importance-ranker.util";
import { buildLayoutTracks } from "./layout";
import { kinematicOptionsForSmoothing } from "./config/kinematic-options.util";
import { applyActiveSpeakerPolicy } from "./identity/active-speaker.util";
import { buildCanonicalPersonTracks } from "./identity/canonical-person.util";
import { AUTOFLIP_ANALYZER_VERSION, AUTOFLIP_MAX_SCENE_FRAMES, AUTOFLIP_MODEL_ID } from "./config/config.constants";
import { DEFAULT_ARBITER_PARAMS, LEGACY_ARBITER_PARAMS } from "./layout";
import { smoothShotCropSamples } from "./camera/shot-smoothing.util";
import { DEFAULT_VISIBILITY_PARAMS } from "./layout";
import type { FocusPointFrame, KeyFrameSalientInput, SalientSignalType } from "../types/autoflip.types";
import type { BuildAutoFlipTrackInput } from "../types/autoflip.types";

import {
  expandCropAcrossBars,
  FULL_FRAME,
  intoContentRect,
  intoSourceRect,
  validContentRect,
} from "./content-rect.util";

const FOREGROUND_SIGNALS = new Set<SalientSignalType>(["face_core", "face_all", "face_full", "pose_head", "pose_torso", "human", "pet", "car"]);

function hasForegroundSalience(keyframes: KeyFrameSalientInput[]): boolean {
  return keyframes.some((keyframe) => keyframe.regions.some((region) => FOREGROUND_SIGNALS.has(region.signalType)));
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
    importanceSignals: sample.importanceSignals?.flatMap((region) => {
      const box = intoContentRect(region.box, content);
      return box ? [{ ...region, box }] : [];
    }),
  }));
}

function importanceSignalsInContent(
  samples: ImportanceSignalSample[] | undefined,
  content: NormalizedBox,
): ImportanceSignalSample[] | undefined {
  if (!samples || content === FULL_FRAME) return samples;
  return samples.map((sample) => ({
    ...sample,
    regions: sample.regions.flatMap((region) => {
      const box = intoContentRect(region.box, content);
      return box ? [{ ...region, box }] : [];
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

export function buildAutoFlipTrack(input: BuildAutoFlipTrackInput): ClipperSmartCropBlob {
  const sourceFrameWidth = input.frameWidth ?? 1920;
  const sourceFrameHeight = input.frameHeight ?? 1080;
  const contentRect = validContentRect(input.contentRect);
  const frameWidth = sourceFrameWidth * contentRect.width;
  const frameHeight = sourceFrameHeight * contentRect.height;
  const sourceFrameRate = Number.isFinite(input.sourceFrameRate) && input.sourceFrameRate! > 0 ? input.sourceFrameRate! : 30;
  const kinematicOptions = kinematicOptionsForSmoothing(input.smoothing ?? "balanced");
  const scenes = splitScenes(input.clipStart, input.clipEnd, input.sceneCuts, sourceFrameRate);
  const canonicalFusion = buildCanonicalPersonTracks(input.detections);
  const activeSpeaker = applyActiveSpeakerPolicy(canonicalFusion.samples);
  const contentDetections = detectionsInContent(
    input.enhancedIdentityFusion ? activeSpeaker.samples : input.detections,
    contentRect,
  );
  const rawKeyframes = buildSalientKeyframes({
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    detections: contentDetections,
    sceneCuts: input.sceneCuts,
  });
  const semanticKeyframes = attachImportanceSignals(
    rawKeyframes,
    input.importanceSignals
      ? importanceSignalsInContent(input.importanceSignals, contentRect)
      : contentDetections.flatMap((sample) => sample.importanceSignals?.length
        ? [{ time: sample.time, regions: sample.importanceSignals }]
        : []),
  );
  const importanceSamples = buildImportanceTimeline(semanticKeyframes).map((sample) => ({
    ...sample,
    regions: sample.regions.map((region) => ({
      ...region,
      box: intoSourceRect(region.box, contentRect),
      contentBox: intoSourceRect(region.contentBox, contentRect),
    })),
  }));

  const targets = Object.keys(input.targetAspectRatios ?? {}).length
    ? input.targetAspectRatios!
    : { default: input.targetAspectRatio ?? 9 / 16 };
  const aspectTracks: Record<string, AutoFlipAspectTrack> = {};
  const debugScenes: AutoFlipSceneDebug[] | undefined = input.collectDebug ? [] : undefined;

  for (const [formatId, targetAspectRatio] of Object.entries(targets)) {
    const samples: AutoFlipCropSample[] = [];
    // The crop window never shrinks below the nominal cover crop. A zoomed
    // window caps how much of the subject's full-height context band the
    // output can retain, which loses vertical content that reframing is
    // supposed to preserve; the stock AutoFlip SceneCameraMotionAnalyzer
    // likewise keeps the target-sized window and moves it instead of scaling.
    // Product policy layered on top of AutoFlip: when BorderDetection found a
    // stable solid background, retaining the active image and padding it is
    // preferable to throwing away slide/gameplay content merely to fill a
    // vertical target. The renderer recognizes this non-matching aspect and
    // uses the graph-compatible solid-colour padding path.
    let continuationFocus: FocusPointFrame[] = [];
    for (const scene of scenes) {
      // The production baseline intentionally uses only Run4 inputs. Motion
      // and other experimental importance proposals must never move it.
      const sceneKeyframes = rawKeyframes.filter(
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
    const sourceAspect = sourceFrameWidth / Math.max(1, sourceFrameHeight);
    const smoothedSamples = smoothShotCropSamples(samples, input.sceneCuts);
    aspectTracks[formatId] = {
      targetAspectRatio,
      samples: smoothedSamples.map((sample) => ({
        ...sample,
        crop: expandCropAcrossBars(sample.crop, contentRect, sourceAspect, targetAspectRatio),
      })),
    };
  }

  const primaryTrack = aspectTracks[Object.keys(aspectTracks)[0]!]!;
  const layoutTracks = buildLayoutTracks({
    aspectTracks,
    importanceSamples,
    frameWidth: sourceFrameWidth,
    frameHeight: sourceFrameHeight,
    arbiterParams: {
      ...(input.enhancedIdentityFusion ? DEFAULT_ARBITER_PARAMS : LEGACY_ARBITER_PARAMS),
      allowGroupUnion: true,
    },
    visibilityControllerParams: input.enhancedIdentityFusion
      ? { ...DEFAULT_VISIBILITY_PARAMS }
      : undefined,
  });

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
    aspectTracks,
    importanceSamples,
    layoutTracks,
    canonicalIdentityTelemetry: canonicalFusion.telemetry,
    activeSpeakerTelemetry: activeSpeaker.telemetry,
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

/** Sample count from the first aspect track — used for pipeline metadata. */
export function primaryAspectTrackSampleCount(blob: ClipperSmartCropBlob): number {
  const tracks = blob.aspectTracks;
  if (!tracks) return 0;
  const first = Object.values(tracks)[0];
  return first?.samples.length ?? 0;
}

export { AUTOFLIP_ANALYZER_VERSION, AUTOFLIP_MODEL_ID } from "./config/config.constants";

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
