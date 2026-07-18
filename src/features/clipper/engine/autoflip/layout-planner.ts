import type {
  AutoFlipAspectTrack,
  ClipperLayoutMode,
  ClipperLayoutSample,
  ClipperLayoutTrack,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop";
import { importanceGeometry } from "./importance-ranker";
import {
  DEFAULT_ARBITER_PARAMS,
  decideLayoutStrategy,
  importanceAtTime,
  interpolateBox,
  motionTypeAt,
  precedingIndex,
  proposalScore,
  requiredRegions,
  type ArbiterParams,
  type ArbiterSceneMotion,
} from "./layout-arbiter";

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unionAll(boxes: NormalizedBox[]): NormalizedBox | null {
  return boxes.reduce<NormalizedBox | null>(
    (result, box) => result ? importanceGeometry.unionBoxes(result, box) : { ...box },
    null,
  );
}

function expandBox(box: NormalizedBox, margin: number): NormalizedBox {
  const x = clamp(box.x - box.width * margin, 0, 1);
  const y = clamp(box.y - box.height * margin, 0, 1);
  const right = clamp(box.x + box.width * (1 + margin), 0, 1);
  const bottom = clamp(box.y + box.height * (1 + margin), 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

function nominalCropSize(sourceAspect: number, targetAspect: number): { width: number; height: number } {
  if (sourceAspect >= targetAspect) return { width: targetAspect / sourceAspect, height: 1 };
  return { width: 1, height: sourceAspect / targetAspect };
}

function boxFitsStrictCrop(box: NormalizedBox, sourceAspect: number, targetAspect: number): boolean {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const expanded = expandBox(box, 0.08);
  return expanded.width <= nominal.width + EPSILON && expanded.height <= nominal.height + EPSILON;
}

function cropAroundBox(
  box: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  minimumScale = 0.3,
): NormalizedBox {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const expanded = expandBox(box, 0.18);
  const scale = clamp(Math.max(
    minimumScale,
    expanded.width / Math.max(EPSILON, nominal.width),
    expanded.height / Math.max(EPSILON, nominal.height),
  ), minimumScale, 1);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * 0.44;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

function strictAspectViewport(
  viewport: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
): NormalizedBox {
  const nominal = nominalCropSize(sourceAspect, targetAspect);
  const scale = clamp(Math.max(
    viewport.width / Math.max(EPSILON, nominal.width),
    viewport.height / Math.max(EPSILON, nominal.height),
  ), 0.05, 1);
  const width = nominal.width * scale;
  const height = nominal.height * scale;
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

function centerViewportOnBox(viewport: NormalizedBox, box: NormalizedBox): NormalizedBox {
  const centerX = box.x + box.width / 2;
  // A slight upward bias preserves natural headroom for both faces and bodies.
  const centerY = box.y + box.height * 0.44;
  return {
    ...viewport,
    x: clamp(centerX - viewport.width / 2, 0, 1 - viewport.width),
    y: clamp(centerY - viewport.height / 2, 0, 1 - viewport.height),
  };
}

function rawMode(
  sample: ImportanceRegionSample,
  sourceAspect: number,
  targetAspect: number,
): ClipperLayoutMode {
  const required = requiredRegions(sample);
  if (!required.length) return "single-crop";
  const union = unionAll(required.map((region) => region.contentBox))!;
  if (boxFitsStrictCrop(union, sourceAspect, targetAspect)) return "single-crop";
  if (required.length >= 2 && targetAspect <= 1) {
    const overlap = importanceGeometry.overlapFractionOfSmaller(required[0]!.contentBox, required[1]!.contentBox);
    if (overlap < 0.35) return "split";
  }
  return "contain";
}

interface ModeDecision {
  time: number;
  mode: ClipperLayoutMode;
  cut?: boolean;
}

function stabilizeModes(
  samples: ImportanceRegionSample[],
  sourceAspect: number,
  targetAspect: number,
): ModeDecision[] {
  let stable: ClipperLayoutMode = "single-crop";
  let pending: ClipperLayoutMode | null = null;
  let pendingCount = 0;
  return samples.map((sample, index) => {
    const desired = rawMode(sample, sourceAspect, targetAspect);
    if (index === 0 || sample.cut) {
      stable = desired;
      pending = null;
      pendingCount = 0;
    } else if (desired === stable) {
      pending = null;
      pendingCount = 0;
    } else {
      if (pending === desired) pendingCount++;
      else {
        pending = desired;
        pendingCount = 1;
      }
      const threshold = desired === "single-crop" ? 3 : 2;
      if (pendingCount >= threshold) {
        stable = desired;
        pending = null;
        pendingCount = 0;
      }
    }
    return { time: sample.time, mode: stable, cut: sample.cut };
  });
}

function modeAtTime(decisions: ModeDecision[], time: number): ClipperLayoutMode {
  if (!decisions.length) return "single-crop";
  return decisions[precedingIndex(decisions, time)]!.mode;
}

function buildViewports(
  mode: ClipperLayoutMode,
  importance: ImportanceRegionSample,
  fallbackCrop: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
): NormalizedBox[] {
  const required = requiredRegions(importance);
  if (mode === "contain" && !required.length) return [fallbackCrop];
  if (mode === "single-crop" || !required.length) {
    const viewport = strictAspectViewport(fallbackCrop, sourceAspect, targetAspect);
    const primary = required.find((region) => region.role === "primary") ?? required[0];
    return [primary ? centerViewportOnBox(viewport, primary.box) : viewport];
  }
  if (mode === "split" && required.length >= 2) {
    const panelAspect = targetAspect * 2;
    return [
      cropAroundBox(required[0]!.contentBox, sourceAspect, panelAspect),
      cropAroundBox(required[1]!.contentBox, sourceAspect, panelAspect),
    ];
  }
  const union = unionAll(required.map((region) => region.contentBox)) ?? required[0]!.contentBox;
  return [expandBox(union, 0.12)];
}

export interface BuildLayoutTracksInput {
  aspectTracks: Record<string, AutoFlipAspectTrack>;
  importanceSamples: ImportanceRegionSample[];
  frameWidth: number;
  frameHeight: number;
  /** Arbiter thresholds; omit for the calibrated production defaults. */
  arbiterParams?: ArbiterParams;
  /** Per-scene camera-motion classification, for motion-aware arbitration. */
  sceneMotion?: ArbiterSceneMotion[];
}

/** Builds stable format-aware render decisions over the smooth legacy camera path. */
export function buildLayoutTracks(input: BuildLayoutTracksInput): Record<string, ClipperLayoutTrack> {
  const sourceAspect = input.frameWidth / Math.max(1, input.frameHeight);
  const arbiterParams = input.arbiterParams ?? DEFAULT_ARBITER_PARAMS;
  return Object.fromEntries(Object.entries(input.aspectTracks).map(([formatId, aspectTrack]) => {
    const samples: ClipperLayoutSample[] = aspectTrack.samples.map((cropSample) => {
      const importance = importanceAtTime(input.importanceSamples, cropSample.t);
      const fallbackPixelAspect = cropSample.crop.width * sourceAspect / Math.max(EPSILON, cropSample.crop.height);
      const explicitPadding = cropSample.solidBackgroundColor != null
        && Math.abs(fallbackPixelAspect - aspectTrack.targetAspectRatio) > 0.001;
      const required = requiredRegions(importance);
      const baselineMode: ClipperLayoutMode = explicitPadding
        || Math.abs(fallbackPixelAspect - aspectTrack.targetAspectRatio) > 0.001
        ? "contain"
        : "single-crop";
      const baselineViewports = [cropSample.crop];
      const importanceIndex = precedingIndex(input.importanceSamples, cropSample.t);
      const desiredMode = rawMode(importance, sourceAspect, aspectTrack.targetAspectRatio);
      const semanticViewports = buildViewports(
        desiredMode,
        importance,
        cropSample.crop,
        sourceAspect,
        aspectTrack.targetAspectRatio,
      );
      const baselineScore = proposalScore(baselineViewports, required);
      const semanticScore = proposalScore(semanticViewports, required);
      const decision = decideLayoutStrategy({
        t: cropSample.t,
        cut: Boolean(cropSample.cut),
        explicitPadding,
        desiredMode,
        required,
        baselineScore,
        semanticScore,
        semanticViewports,
        importanceSamples: input.importanceSamples,
        importanceIndex,
        motionType: motionTypeAt(input.sceneMotion, formatId, cropSample.t),
      }, arbiterParams);
      return {
        t: cropSample.t,
        mode: decision.selectSemantic ? desiredMode : baselineMode,
        strategy: decision.strategy,
        viewports: decision.selectSemantic ? semanticViewports : baselineViewports,
        candidateMode: desiredMode,
        candidateViewports: semanticViewports,
        baselineViewports,
        primaryRegionId: required.find((region) => region.role === "primary")?.id,
        requiredRegionIds: required.map((region) => region.id),
        baselineScore,
        semanticScore,
        decisionConfidence: decision.decisionConfidence,
        reasonCodes: decision.reasonCodes,
        cut: cropSample.cut,
        solidBackgroundColor: cropSample.solidBackgroundColor,
      };
    });
    return [formatId, { targetAspectRatio: aspectTrack.targetAspectRatio, samples }];
  }));
}

export function resolveLayoutTrack(
  tracks: Record<string, ClipperLayoutTrack> | undefined,
  formatId: string,
): ClipperLayoutTrack | null {
  return tracks?.[formatId] ?? tracks?.default ?? null;
}

/** Interpolates camera geometry but never blends across a cut or a layout-mode change. */
export function interpolateLayoutSample(
  track: ClipperLayoutTrack | null,
  time: number,
): ClipperLayoutSample | null {
  if (!track?.samples.length) return null;
  const index = precedingIndex(track.samples.map((sample) => ({ ...sample, time: sample.t })), time);
  const previous = track.samples[index]!;
  const next = track.samples[index + 1];
  if (!next || next.cut || next.mode !== previous.mode || next.strategy !== previous.strategy || next.viewports.length !== previous.viewports.length) {
    return { ...previous, t: time };
  }
  const factor = clamp((time - previous.t) / Math.max(EPSILON, next.t - previous.t), 0, 1);
  return {
    ...previous,
    t: time,
    viewports: previous.viewports.map((viewport, viewportIndex) =>
      interpolateBox(viewport, next.viewports[viewportIndex]!, factor)),
    candidateViewports: previous.candidateViewports?.length === next.candidateViewports?.length
      ? previous.candidateViewports.map((viewport, viewportIndex) =>
          interpolateBox(viewport, next.candidateViewports![viewportIndex]!, factor))
      : previous.candidateViewports,
  };
}

export const layoutGeometry = {
  boxFitsStrictCrop,
  centerViewportOnBox,
  cropAroundBox,
  nominalCropSize,
  strictAspectViewport,
};
