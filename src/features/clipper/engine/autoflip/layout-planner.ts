import type {
  AutoFlipAspectTrack,
  ClipperLayoutMode,
  ClipperLayoutSample,
  ClipperLayoutStrategy,
  ClipperLayoutTrack,
  ImportanceRegion,
  ImportanceRegionSample,
  NormalizedBox,
} from "../../shared/smart-crop";
import { importanceGeometry } from "./importance-ranker";

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

function requiredRegions(sample: ImportanceRegionSample): ImportanceRegion[] {
  return sample.regions.filter((region) => region.required).slice(0, 2);
}

function coveredFraction(viewport: NormalizedBox, box: NormalizedBox): number {
  const area = Math.max(EPSILON, box.width * box.height);
  return clamp(importanceGeometry.intersectionArea(viewport, box) / area, 0, 1);
}

function proposalScore(viewports: NormalizedBox[], required: ImportanceRegion[]): number {
  if (!required.length || !viewports.length) return 0;
  const totalWeight = required.reduce((sum, region) => sum + Math.max(0.01, region.importanceScore), 0);
  const coverage = required.reduce((sum, region) =>
    sum + Math.max(...viewports.map((viewport) => coveredFraction(viewport, region.contentBox))) * region.importanceScore, 0) / totalWeight;
  const primary = required.find((region) => region.role === "primary") ?? required[0]!;
  const primaryX = primary.box.x + primary.box.width / 2;
  const primaryY = primary.box.y + primary.box.height / 2;
  const distance = Math.min(...viewports.map((viewport) => {
    const dx = primaryX - (viewport.x + viewport.width / 2);
    const dy = primaryY - (viewport.y + viewport.height / 2);
    return Math.hypot(dx, dy);
  }));
  const composition = 1 - clamp(distance / 0.25, 0, 1);
  return coverage * 0.7 + composition * 0.3;
}

function semanticSources(region: ImportanceRegion): string[] {
  return region.sources.filter((source) => source !== "motion");
}

function isReliablePrimary(region: ImportanceRegion): boolean {
  const sources = semanticSources(region);
  const faceConfirmed = sources.some((source) => source === "face" || source === "head" || source === "active-speaker");
  return !region.predicted
    && region.importanceScore >= 0.9
    && ((faceConfirmed && region.confidence >= 0.82)
      || (new Set(sources).size >= 2 && region.confidence >= 0.75));
}

function stableRequiredIds(samples: ImportanceRegionSample[], index: number): boolean {
  const current = requiredRegions(samples[index]!);
  if (!current.length) return false;
  const ids = current.map((region) => region.id).sort().join("|");
  let matching = 1;
  const currentTime = samples[index]!.time;
  for (let cursor = index - 1; cursor >= 0 && matching < 4; cursor--) {
    const sample = samples[cursor]!;
    if (samples[cursor + 1]!.cut || sample.cut) break;
    const prior = requiredRegions(sample);
    if (!prior.length && currentTime - sample.time <= 0.6 + EPSILON) continue;
    const priorIds = prior.map((region) => region.id).sort().join("|");
    if (priorIds !== ids) break;
    matching++;
  }
  return matching >= 4;
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

function precedingIndex<T extends { time: number }>(items: T[], time: number): number {
  if (!items.length || time <= items[0]!.time) return 0;
  if (items.length === 1 || time >= items.at(-1)!.time) return items.length - 1;
  let low = 1;
  let high = items.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (items[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  return items[low]!.time <= time ? low : low - 1;
}

function interpolateBox(a: NormalizedBox, b: NormalizedBox, factor: number): NormalizedBox {
  return {
    x: a.x + (b.x - a.x) * factor,
    y: a.y + (b.y - a.y) * factor,
    width: a.width + (b.width - a.width) * factor,
    height: a.height + (b.height - a.height) * factor,
  };
}

function importanceAtTime(samples: ImportanceRegionSample[], time: number): ImportanceRegionSample {
  if (!samples.length) return { time, regions: [] };
  const index = precedingIndex(samples, time);
  const previous = samples[index]!;
  const next = samples[index + 1];
  // Offline analysis may safely backfill a short detector dropout, but never
  // across a shot boundary. This fixes empty first samples without inventing
  // long look-ahead behavior.
  if (!previous.regions.length && next?.regions.length && !next.cut && next.time - time <= 0.4 + EPSILON) {
    return { ...next, time, cut: previous.cut };
  }
  if (!next || next.cut || next.time <= previous.time + EPSILON) return { ...previous, time };
  const factor = clamp((time - previous.time) / (next.time - previous.time), 0, 1);
  const regions = previous.regions.map((region) => {
    const nextRegion = next.regions.find((candidate) => candidate.id === region.id);
    return nextRegion ? {
      ...region,
      box: interpolateBox(region.box, nextRegion.box, factor),
      contentBox: interpolateBox(region.contentBox, nextRegion.contentBox, factor),
      importanceScore: region.importanceScore + (nextRegion.importanceScore - region.importanceScore) * factor,
    } : region;
  });
  return { time, regions, cut: previous.cut };
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
}

/** Builds stable format-aware render decisions over the smooth legacy camera path. */
export function buildLayoutTracks(input: BuildLayoutTracksInput): Record<string, ClipperLayoutTrack> {
  const sourceAspect = input.frameWidth / Math.max(1, input.frameHeight);
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
      const stable = input.importanceSamples.length > 0 && stableRequiredIds(input.importanceSamples, importanceIndex);
      const primary = required.find((region) => region.role === "primary") ?? required[0];
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
      const dualReliable = desiredMode === "split"
        && required.length === 2
        && required.every((region) => !region.predicted && region.confidence >= 0.75 && region.importanceScore >= 0.75);
      const reliable = Boolean(primary && isReliablePrimary(primary) && (desiredMode !== "split" || dualReliable));
      const improvement = semanticScore - baselineScore;
      const selectSemantic = !cropSample.cut
        && !explicitPadding
        && stable
        && reliable
        // Split/contain remain available as shadow candidates, but Run4's
        // collage/contain path stays authoritative until those candidates
        // beat its dual-visibility result in a full benchmark.
        && desiredMode === "single-crop"
        && improvement >= 0.15;
      const strategy: ClipperLayoutStrategy = selectSemantic
        ? desiredMode === "split"
          ? "semantic-split"
          : desiredMode === "contain"
            ? "semantic-contain"
            : "semantic-single"
        : "legacy-baseline";
      const reasonCodes = selectSemantic
        ? ["stable-semantic-target", "proposal-margin"]
        : [
            ...(cropSample.cut ? ["shot-boundary"] : []),
            ...(explicitPadding ? ["baseline-padding"] : []),
            ...(!stable ? ["unstable-target"] : []),
            ...(!reliable ? ["insufficient-semantic-evidence"] : []),
            ...(improvement < 0.15 ? ["insufficient-proposal-margin"] : []),
          ];
      return {
        t: cropSample.t,
        mode: selectSemantic ? desiredMode : baselineMode,
        strategy,
        viewports: selectSemantic ? semanticViewports : baselineViewports,
        candidateMode: desiredMode,
        candidateViewports: semanticViewports,
        primaryRegionId: required.find((region) => region.role === "primary")?.id,
        requiredRegionIds: required.map((region) => region.id),
        baselineScore,
        semanticScore,
        decisionConfidence: clamp(Math.max(0, improvement) / 0.3, 0, 1),
        reasonCodes,
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
