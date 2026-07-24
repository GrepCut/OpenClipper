import { clamp } from "../../../lib/math.util";
import type {
  ClipperLayoutSample,
  ClipperLayoutTrack,
} from "../../../shared/smart-crop.util";
import {
  coveredFraction,
  interpolateBox,
  precedingIndex,
} from "./arbiter.util";
import { interpolateCameraBox } from "../camera/trajectory-interpolation.util";
import { splitPanelsPreserveSubjects, splitViewportsAreDistinct } from "./viewport-geometry.util";

const EPSILON = 1e-9;

function samePanelOwners(a: ClipperLayoutSample, b: ClipperLayoutSample): boolean {
  if (a.mode !== "split") return true;
  const aOwners = a.panelSubjects;
  const bOwners = b.panelSubjects;
  if (!aOwners || !bOwners) return !aOwners && !bOwners;
  return aOwners.length === bOwners.length
    && aOwners.every((owner, index) => owner.id === bOwners[index]?.id);
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
  if (!next || next.cut || next.mode !== previous.mode || next.viewports.length !== previous.viewports.length || !samePanelOwners(previous, next)) {
    return { ...previous, t: time };
  }
  const factor = clamp((time - previous.t) / Math.max(EPSILON, next.t - previous.t), 0, 1);
  const interpolatedViewports = previous.viewports.map((viewport, viewportIndex) =>
    interpolateCameraBox(
      { t: previous.t, box: viewport },
      { t: next.t, box: next.viewports[viewportIndex]! },
      time,
    ));
  const previousCoverageBoxes = previous.coverageBoxes;
  const nextCoverageBoxes = next.coverageBoxes;
  const interpolatedCoverageBoxes = previousCoverageBoxes?.length === nextCoverageBoxes?.length
      ? previousCoverageBoxes?.map((box, index) => interpolateBox(box, nextCoverageBoxes![index]!, factor))
    : previous.coverageBoxes;
  const interpolationSafe = !interpolatedCoverageBoxes?.length || interpolatedCoverageBoxes.every((box) =>
    interpolatedViewports.some((viewport) => coveredFraction(viewport, box) >= 1 - EPSILON));
  if (previous.mode === "split" && (
    !splitViewportsAreDistinct(interpolatedViewports)
    || !splitPanelsPreserveSubjects(interpolatedViewports, previous.panelSubjects)
  )) {
    return { ...previous, t: time, reasonCodes: [...(previous.reasonCodes ?? []), "interpolation-panel-owner-risk"] };
  }
  return {
    ...previous,
    t: time,
    viewports: interpolatedViewports,
    // Do not freeze the camera while coverage diagnostics are marginal. A
    // held sparse keyframe causes the visible staircase/catch-up jump.
    reasonCodes: interpolationSafe
      ? previous.reasonCodes
      : [...(previous.reasonCodes ?? []), "interpolation-coverage-risk"],
    candidateViewports: previous.candidateViewports?.length === next.candidateViewports?.length
      ? previous.candidateViewports?.map((viewport, viewportIndex) =>
          interpolateBox(viewport, next.candidateViewports![viewportIndex]!, factor))
      : previous.candidateViewports,
  };
}
