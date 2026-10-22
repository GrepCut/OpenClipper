import { resolveAutoFlipCropTrack } from "../../engine/autoflip/build-track.util";
import { resolveLayoutTrack } from "../../engine/autoflip/layout";
import {
  resolveClipperFrameGeometry,
  type ClipperFrameGeometry,
} from "../../engine/render/frame-geometry.util";
import type { ClipperClipSegmentWindow } from "../../engine/segmentation";
import type { FrameEffectSize } from "../media/video-frame-effect.util";
import type { ClipperFormatDef } from "../../shared/formats.util";
import {
  isClipperRuntimeSmartCropBlob,
  type ClipperFrameAnalysis,
} from "../../shared/smart-crop.util";
import type {
  ClipperStudioFramePanel,
  ClipperStudioFrameSample,
} from "./clipper-studio-import.types";

const STUDIO_FRAME_GRID_SEC = 0.1;
const STUDIO_CUT_LEAD_SEC = 0.001;
const STUDIO_TIME_EPSILON_SEC = 0.0001;

interface RawTrackSample {
  t: number;
  cut?: boolean;
  mode?: string;
}

export interface SampleStudioFrameTrackInput {
  formatDef: ClipperFormatDef;
  source: FrameEffectSize;
  output: FrameEffectSize;
  analysis: ClipperFrameAnalysis | null;
  disabledCollageRegionIds: string[];
  segments: ClipperClipSegmentWindow[];
}

/**
 * Every persisted track the preview may read for this format, each sorted by
 * time, in source-timeline seconds. Tracks stay separate: switches are only
 * meaningful between neighbouring samples of the same track.
 */
function rawTracks(
  analysis: ClipperFrameAnalysis | null,
  formatDef: ClipperFormatDef,
): RawTrackSample[][] {
  if (!analysis) return [];
  const tracks: Array<RawTrackSample[] | undefined> = isClipperRuntimeSmartCropBlob(analysis)
    ? [
        (analysis.layoutTracks[formatDef.aspectId]
          ?? analysis.layoutTracks[formatDef.id]
          ?? analysis.layoutTracks.default)?.samples,
      ]
    : [
        resolveLayoutTrack(analysis.layoutTracks, formatDef.id)?.samples,
        resolveAutoFlipCropTrack(analysis, formatDef.id)?.samples,
      ];
  return tracks
    .filter((samples): samples is RawTrackSample[] => Boolean(samples?.length))
    .map((samples) => [...samples].sort((a, b) => a.t - b.t));
}

/** Whether `sample` is a hard cut or a layout-mode switch after `previous` on the same track. */
function isSwitch(previous: RawTrackSample | undefined, sample: RawTrackSample): boolean {
  return Boolean(sample.cut) || (previous?.mode != null && previous.mode !== sample.mode);
}

/** Times of persisted hard cuts and layout-mode switches. */
function switchTimes(tracks: RawTrackSample[][]): number[] {
  return tracks.flatMap((track) =>
    track.filter((sample, index) => isSwitch(track[index - 1], sample)).map((sample) => sample.t),
  );
}

/**
 * Raw sample times, a fixed grid and a lead-in just before every hard switch,
 * so the hold before a cut lands on the same frame as in the preview.
 */
function sampleTimes(
  tracks: RawTrackSample[][],
  cuts: number[],
  segments: ClipperClipSegmentWindow[],
): number[] {
  const times: number[] = [];
  const rawTimes = tracks.flatMap((track) => track.map((sample) => sample.t));
  const leadTimes = cuts.map((cut) => cut - STUDIO_CUT_LEAD_SEC);
  for (const segment of segments) {
    const inside = (t: number) => t >= segment.startSec && t <= segment.endSec;
    for (let t = segment.startSec; t < segment.endSec; t += STUDIO_FRAME_GRID_SEC) {
      times.push(t);
    }
    times.push(segment.endSec);
    times.push(...rawTimes.filter(inside), ...leadTimes.filter(inside));
  }
  times.sort((a, b) => a - b);
  return times.filter((t, index) => index === 0 || t - times[index - 1]! > STUDIO_TIME_EPSILON_SEC);
}

/** Normalizes the pixel-space geometry the preview draws. */
function toStudioPanels(
  geometry: ClipperFrameGeometry,
  source: FrameEffectSize,
  output: FrameEffectSize,
): ClipperStudioFramePanel[] {
  return geometry.panels.map((panel) => ({
    source: {
      x: panel.source.sx / source.width,
      y: panel.source.sy / source.height,
      width: panel.source.sw / source.width,
      height: panel.source.sh / source.height,
    },
    destination: {
      x: panel.destination.x / output.width,
      y: panel.destination.y / output.height,
      width: panel.destination.width / output.width,
      height: panel.destination.height / output.height,
    },
  }));
}

/**
 * Samples the exact preview geometry (`resolveClipperFrameGeometry`) over the
 * clip so Studio reproduces the preview: same crop, same split panels, same
 * disabled collage regions, same content-rect clamp and the same cut timing.
 */
export function sampleStudioFrameTrack(input: SampleStudioFrameTrackInput): ClipperStudioFrameSample[] {
  const { formatDef, source, output, analysis, disabledCollageRegionIds, segments } = input;
  if (!(source.width > 0 && source.height > 0)) {
    throw new Error("Source video dimensions are unknown; wait for the preview to load.");
  }
  const tracks = rawTracks(analysis, formatDef);
  const cuts = switchTimes(tracks);
  const isCutTime = (t: number) => cuts.some((cut) => Math.abs(cut - t) <= STUDIO_TIME_EPSILON_SEC);
  const render = { smartCropAnalysis: analysis, disabledCollageRegionIds };

  const samples: ClipperStudioFrameSample[] = [];
  for (const t of sampleTimes(tracks, cuts, segments)) {
    const geometry = resolveClipperFrameGeometry(formatDef, source, output, t, render);
    const panels = toStudioPanels(geometry, source, output);
    const previous = samples.at(-1);
    const sample: ClipperStudioFrameSample = { t, panels };
    if (isCutTime(t) || (previous && previous.panels.length !== panels.length)) {
      sample.cut = true;
    }
    samples.push(sample);
  }
  return samples;
}
