import type {
  ClipperLayoutMode,
  ClipperLayoutSample,
  NormalizedBox,
  SubjectDetectionSample,
} from "../../../shared/smart-crop.util";
import type { ActiveSpeakerTurns } from "../../types/autoflip.types";
import {
  ACTIVE_SPEAKER_MIN_TURN_SEC,
  CONVERSATION_BRIDGE_SEC,
  CONVERSATION_MAX_FACE_TRAVEL,
  CONVERSATION_MIN_DURATION_SEC,
  CONVERSATION_MIN_FACE_PANEL_HEIGHT,
  CONVERSATION_MIN_PRESENCE,
  CONVERSATION_MIN_SPEAKERS,
  CONVERSATION_WINDOW_SEC,
} from "../config/config.constants";
import { clamp } from "../../../lib/math.util";
import { framingCenterYFraction, nominalCropSize } from "./viewport-geometry.util";

/**
 * Conversation layout planner.
 *
 * An editor cutting a podcast or a video call decides the layout once per
 * shot: as many panels as there are people in the conversation, each person
 * framed the same way for the whole shot. The active speaker only decides who
 * takes the lead (top) panel. This module finds such stretches and plans that
 * layout; everything else keeps the per-frame AutoFlip path untouched.
 */

const EPSILON = 1e-9;
const SCALE_STEP = 0.02;
/**
 * Margins (share of a face's size) around the person's own face and around
 * every other face, relaxed step by step only when people sit too close.
 */
const FACE_MARGIN_RELAXATION = [
  { own: 0.1, neighbour: 0.1 },
  { own: 0.1, neighbour: 0 },
  { own: 0, neighbour: 0 },
] as const;

export interface ConversationSlot {
  id: string;
  /** Canonical tracks that belong to this person (ids can change on re-acquisition). */
  trackIds: number[];
  /** Median face box during the conversation. */
  faceBox: NormalizedBox;
  /** 10th–90th percentile extent of the face during the conversation. */
  extentBox: NormalizedBox;
}

export interface ConversationSpan {
  start: number;
  end: number;
  /** Participants, left to right. */
  slots: ConversationSlot[];
  /** Who holds the lead panel from `time` on. The first entry opens the span. */
  leads: Array<{ time: number; slotId: string }>;
}

export interface ConversationLayout {
  mode: ClipperLayoutMode;
  /** One crop that shows everybody (people sitting close together). */
  shared?: NormalizedBox;
  /** Each participant's crop for the lead panel and for the other panels. */
  crops?: Map<string, { lead: NormalizedBox; other: NormalizedBox }>;
}

interface FaceObservation {
  time: number;
  box: NormalizedBox;
}

interface SlotBuild {
  id: string;
  trackIds: number[];
  observations: FaceObservation[];
  times: Set<number>;
  median: NormalizedBox;
}

interface Window {
  start: number;
  end: number;
  ids: string[];
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function medianBox(boxes: NormalizedBox[]): NormalizedBox {
  return {
    x: percentile(boxes.map((box) => box.x), 0.5),
    y: percentile(boxes.map((box) => box.y), 0.5),
    width: percentile(boxes.map((box) => box.width), 0.5),
    height: percentile(boxes.map((box) => box.height), 0.5),
  };
}

function extentBox(boxes: NormalizedBox[]): NormalizedBox {
  const left = percentile(boxes.map((box) => box.x), 0.1);
  const top = percentile(boxes.map((box) => box.y), 0.1);
  const right = percentile(boxes.map((box) => box.x + box.width), 0.9);
  const bottom = percentile(boxes.map((box) => box.y + box.height), 0.9);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const centerX = (box: NormalizedBox) => box.x + box.width / 2;
const centerY = (box: NormalizedBox) => box.y + box.height / 2;
const right = (box: NormalizedBox) => box.x + box.width;
const bottom = (box: NormalizedBox) => box.y + box.height;

function unionBox(boxes: NormalizedBox[]): NormalizedBox {
  return boxes.reduce((box, next) => {
    const x = Math.min(box.x, next.x);
    const y = Math.min(box.y, next.y);
    return { x, y, width: Math.max(right(box), right(next)) - x, height: Math.max(bottom(box), bottom(next)) - y };
  });
}

/**
 * Groups canonical tracks into people. A canonical id can be replaced after a
 * detector dropout; a track that sits where an existing person sits and never
 * co-occurs with them is the same person.
 */
function buildSlots(samples: SubjectDetectionSample[], sceneIndex: number): SlotBuild[] {
  const tracks = new Map<number, FaceObservation[]>();
  for (const sample of samples) {
    for (const face of sample.autoflipFaces ?? []) {
      if (face.trackId == null || face.predicted || face.identityAmbiguous) continue;
      const list = tracks.get(face.trackId) ?? [];
      list.push({ time: sample.time, box: face.box });
      tracks.set(face.trackId, list);
    }
  }
  const slots: SlotBuild[] = [];
  for (const [trackId, observations] of [...tracks].sort((a, b) => b[1].length - a[1].length)) {
    const box = medianBox(observations.map((observation) => observation.box));
    const slot = slots.find((candidate) => {
      const coOccurrences = observations.filter((observation) => candidate.times.has(observation.time)).length;
      return coOccurrences <= 2
        && Math.abs(centerX(box) - centerX(candidate.median)) <= Math.max(box.width, candidate.median.width)
        && Math.abs(centerY(box) - centerY(candidate.median)) <= Math.max(box.height, candidate.median.height);
    });
    if (slot) {
      slot.trackIds.push(trackId);
      slot.observations.push(...observations);
      for (const observation of observations) slot.times.add(observation.time);
      slot.median = medianBox(slot.observations.map((observation) => observation.box));
    } else {
      slots.push({
        id: `conversation-person:${sceneIndex}:${slots.length}`,
        trackIds: [trackId],
        observations: [...observations],
        times: new Set(observations.map((observation) => observation.time)),
        median: box,
      });
    }
  }
  return slots;
}

/** Which people are steadily visible in each short window of the shot. */
function presenceWindows(times: number[], slots: SlotBuild[], start: number, end: number): Window[] {
  const windows: Window[] = [];
  let cursor = 0;
  for (let windowStart = start; windowStart < end - EPSILON; windowStart += CONVERSATION_WINDOW_SEC) {
    const windowEnd = Math.min(end, windowStart + CONVERSATION_WINDOW_SEC);
    const inside: number[] = [];
    while (cursor < times.length && times[cursor]! < windowEnd - EPSILON) {
      if (times[cursor]! >= windowStart - EPSILON) inside.push(times[cursor]!);
      cursor++;
    }
    const ids = inside.length
      ? slots
        .filter((slot) => inside.filter((time) => slot.times.has(time)).length / inside.length >= CONVERSATION_MIN_PRESENCE)
        .map((slot) => slot.id)
        .sort()
      : [];
    windows.push({ start: windowStart, end: windowEnd, ids });
  }
  return windows;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
const subsetOf = (a: string[], b: string[]) => a.every((id) => b.includes(id));

function mergeWindows(windows: Window[]): Window[] {
  const merged: Window[] = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && sameIds(last.ids, window.ids)) last.end = window.end;
    else merged.push({ ...window, ids: [...window.ids] });
  }
  return merged;
}

/**
 * A short detection blip (a face lost for a moment, someone leaning out of
 * frame) between two identical stretches does not end the conversation; a
 * short stretch with fewer people at the start or end of a shot joins it.
 */
function bridgeBlips(input: Window[]): Window[] {
  let runs = mergeWindows(input);
  for (;;) {
    const index = runs.findIndex((run, position) => {
      if (run.end - run.start >= CONVERSATION_BRIDGE_SEC) return false;
      const previous = runs[position - 1];
      const next = runs[position + 1];
      if (previous && next) return sameIds(previous.ids, next.ids);
      const neighbour = previous ?? next;
      return neighbour != null && !sameIds(neighbour.ids, run.ids) && subsetOf(run.ids, neighbour.ids);
    });
    if (index < 0) return runs;
    runs[index]!.ids = [...(runs[index - 1] ?? runs[index + 1])!.ids];
    runs = mergeWindows(runs);
  }
}

function isSeated(observations: FaceObservation[]): boolean {
  const boxes = observations.map((observation) => observation.box);
  const median = medianBox(boxes);
  const travelX = percentile(boxes.map(centerX), 0.9) - percentile(boxes.map(centerX), 0.1);
  const travelY = percentile(boxes.map(centerY), 0.9) - percentile(boxes.map(centerY), 0.1);
  return travelX <= CONVERSATION_MAX_FACE_TRAVEL * median.width
    && travelY <= CONVERSATION_MAX_FACE_TRAVEL * median.height;
}

/** Finds conversation stretches and who leads them, from canonical faces and speaker turns. */
export function detectConversationSpans(input: {
  samples: SubjectDetectionSample[];
  turns: ActiveSpeakerTurns;
  clipStart: number;
  clipEnd: number;
  sceneCuts: number[];
}): ConversationSpan[] {
  if (!input.turns.segments.length) return [];
  const boundaries = [...new Set([input.clipStart, ...input.sceneCuts, input.clipEnd])]
    .filter((time) => time >= input.clipStart && time <= input.clipEnd)
    .sort((a, b) => a - b);
  const ordered = [...input.samples].sort((a, b) => a.time - b.time);
  const spans: ConversationSpan[] = [];
  for (let scene = 0; scene + 1 < boundaries.length; scene++) {
    const sceneStart = boundaries[scene]!;
    const sceneEnd = boundaries[scene + 1]!;
    if (sceneEnd - sceneStart < CONVERSATION_MIN_DURATION_SEC) continue;
    const sceneSamples = ordered.filter((sample) => sample.time >= sceneStart - EPSILON && sample.time < sceneEnd - EPSILON);
    const slots = buildSlots(sceneSamples, scene);
    if (slots.length < 2) continue;
    const times = [...new Set(sceneSamples.map((sample) => sample.time))];
    const slotOfTrack = new Map(slots.flatMap((slot) => slot.trackIds.map((trackId) => [trackId, slot] as const)));

    for (const run of bridgeBlips(presenceWindows(times, slots, sceneStart, sceneEnd))) {
      if (run.ids.length < 2 || run.ids.length > 3 || run.end - run.start < CONVERSATION_MIN_DURATION_SEC) continue;
      const members = slots.filter((slot) => run.ids.includes(slot.id));
      const within = (time: number) => time >= run.start - EPSILON && time < run.end - EPSILON;
      const observations = new Map(members.map((slot) => [slot.id, slot.observations.filter((observation) => within(observation.time))]));
      if (members.some((slot) => !isSeated(observations.get(slot.id)!))) continue;

      const segments = input.turns.segments
        .filter((segment) => segment.end > run.start && segment.start < run.end)
        .flatMap((segment) => {
          const slot = slotOfTrack.get(segment.trackId);
          return slot && run.ids.includes(slot.id)
            ? [{ slotId: slot.id, start: Math.max(run.start, segment.start), end: Math.min(run.end, segment.end) }]
            : [];
        })
        .sort((a, b) => a.start - b.start);
      const speakingSeconds = new Map<string, number>();
      for (const segment of segments) {
        speakingSeconds.set(segment.slotId, (speakingSeconds.get(segment.slotId) ?? 0) + segment.end - segment.start);
      }
      const speakers = [...speakingSeconds.values()].filter((seconds) => seconds >= ACTIVE_SPEAKER_MIN_TURN_SEC).length;
      if (speakers < CONVERSATION_MIN_SPEAKERS) continue;

      const conversationSlots = members
        .map<ConversationSlot>((slot) => {
          const boxes = observations.get(slot.id)!.map((observation) => observation.box);
          return { id: slot.id, trackIds: slot.trackIds, faceBox: medianBox(boxes), extentBox: extentBox(boxes) };
        })
        .sort((a, b) => centerX(a.faceBox) - centerX(b.faceBox));
      const leads: ConversationSpan["leads"] = [{
        time: run.start,
        slotId: segments[0]?.slotId ?? conversationSlots[0]!.id,
      }];
      for (const segment of segments) {
        if (segment.slotId !== leads.at(-1)!.slotId) leads.push({ time: segment.start, slotId: segment.slotId });
      }
      spans.push({ start: run.start, end: run.end, slots: conversationSlots, leads });
    }
  }
  return spans;
}

/** Panel aspect ratios of the rendered split templates (`splitDestinations` in render/frame-geometry). */
export function conversationPanelAspects(count: number, targetAspect: number): { lead: number; other: number } {
  if (count === 2) return { lead: targetAspect * 2, other: targetAspect * 2 };
  return targetAspect < 1
    ? { lead: targetAspect * 2, other: targetAspect }
    : { lead: targetAspect * 0.6, other: targetAspect * 0.8 };
}

/** Head-and-shoulders framing around a face, kept inside the active picture. */
function framingBox(face: NormalizedBox, content: NormalizedBox): NormalizedBox {
  const x = Math.max(content.x, face.x - face.width * 0.25);
  const y = Math.max(content.y, face.y - face.height * 0.3);
  const r = Math.min(right(content), right(face) + face.width * 0.25);
  const b = Math.min(bottom(content), bottom(face) + face.height * 0.6);
  return { x, y, width: r - x, height: b - y };
}

function nominalInContent(sourceAspect: number, targetAspect: number, content: NormalizedBox): { width: number; height: number } {
  const contentAspect = sourceAspect * content.width / Math.max(EPSILON, content.height);
  const nominal = nominalCropSize(contentAspect, targetAspect);
  return { width: nominal.width * content.width, height: nominal.height * content.height };
}

/** All participants in one crop, when they sit close enough together. */
function sharedCrop(slots: ConversationSlot[], sourceAspect: number, targetAspect: number, content: NormalizedBox): NormalizedBox | null {
  const union = unionBox(slots.map((slot) => framingBox(slot.extentBox, content)));
  const { width, height } = nominalInContent(sourceAspect, targetAspect, content);
  if (union.width > width + EPSILON || union.height > height + EPSILON) return null;
  const faces = unionBox(slots.map((slot) => slot.faceBox));
  return {
    x: clamp(centerX(faces) - width / 2, Math.max(content.x, right(union) - width), Math.min(right(content) - width, union.x)),
    y: clamp(
      faces.y + faces.height * framingCenterYFraction(faces, height) - height / 2,
      Math.max(content.y, bottom(union) - height),
      Math.min(bottom(content) - height, union.y),
    ),
    width,
    height,
  };
}

/**
 * The widest crop of one person, at the panel's aspect ratio, that keeps
 * their whole face (with a small margin) and never shows anybody else's face.
 * Searching from the widest scale down gives head and shoulders whenever the
 * neighbours leave room, and a closer shot only when they sit close.
 * Background may repeat between panels; another person's face may not.
 */
function personCrop(
  slot: ConversationSlot,
  others: ConversationSlot[],
  sourceAspect: number,
  panelAspect: number,
  content: NormalizedBox,
): NormalizedBox | null {
  const nominal = nominalInContent(sourceAspect, panelAspect, content);
  const scaleFor = (box: NormalizedBox) => Math.max(box.width / nominal.width, box.height / nominal.height);
  const face = slot.faceBox;
  const withMargin = (box: NormalizedBox, margin: number, bounds?: NormalizedBox): NormalizedBox => {
    const x = Math.max(bounds?.x ?? -Infinity, box.x - box.width * margin);
    const y = Math.max(bounds?.y ?? -Infinity, box.y - box.height * margin);
    return {
      x,
      y,
      width: Math.min(bounds ? right(bounds) : Infinity, right(box) + box.width * margin) - x,
      height: Math.min(bounds ? bottom(bounds) : Infinity, bottom(box) + box.height * margin) - y,
    };
  };

  const place = (scale: number, required: NormalizedBox, blockers: NormalizedBox[]): NormalizedBox | null => {
    const width = nominal.width * scale;
    const height = nominal.height * scale;
    const yLow = Math.max(content.y, bottom(required) - height);
    const yHigh = Math.min(bottom(content) - height, required.y);
    if (yLow > yHigh + EPSILON) return null;
    const y = clamp(face.y + face.height * framingCenterYFraction(face, height) - height / 2, yLow, yHigh);
    let xLow = Math.max(content.x, right(required) - width);
    let xHigh = Math.min(right(content) - width, required.x);
    for (const blocker of blockers) {
      const overlapsVertically = Math.min(y + height, bottom(blocker)) - Math.max(y, blocker.y) > EPSILON;
      if (!overlapsVertically) continue;
      if (centerX(blocker) < centerX(face)) xLow = Math.max(xLow, right(blocker));
      else xHigh = Math.min(xHigh, blocker.x - width);
    }
    if (xLow > xHigh + EPSILON) return null;
    return { x: clamp(centerX(face) - width / 2, xLow, xHigh), y, width, height };
  };

  // Prefer room around the person's own face and a clear gap to the
  // neighbour's; people sitting very close still get a clean panel that ends
  // right at the faces' edges, never one that shows two faces.
  for (const { own, neighbour } of FACE_MARGIN_RELAXATION) {
    const required = withMargin(slot.extentBox, own, content);
    const minimumScale = scaleFor(required);
    if (minimumScale > 1 + EPSILON) continue;
    const maximumScale = Math.max(minimumScale, Math.min(1, face.height / (CONVERSATION_MIN_FACE_PANEL_HEIGHT * nominal.height)));
    const blockers = others.map((other) => withMargin(other.extentBox, neighbour));
    for (let scale = maximumScale; scale > minimumScale + EPSILON; scale -= SCALE_STEP) {
      const crop = place(scale, required, blockers);
      if (crop) return crop;
    }
    const crop = place(minimumScale, required, blockers);
    if (crop) return crop;
  }
  return null;
}

/**
 * Fixed geometry for one conversation in one output format, or null when the
 * format cannot show it better than the regular path (wide outputs, or a
 * person who cannot get a clean panel).
 */
export function planConversationLayout(
  span: ConversationSpan,
  sourceAspect: number,
  targetAspect: number,
  content: NormalizedBox,
): ConversationLayout | null {
  // Split screens exist only for square and taller outputs.
  if (targetAspect > 1 + EPSILON) return null;
  const shared = sharedCrop(span.slots, sourceAspect, targetAspect, content);
  if (shared) return { mode: "single-crop", shared };
  const aspects = conversationPanelAspects(span.slots.length, targetAspect);
  const crops = new Map<string, { lead: NormalizedBox; other: NormalizedBox }>();
  for (const slot of span.slots) {
    const others = span.slots.filter((candidate) => candidate.id !== slot.id);
    const lead = personCrop(slot, others, sourceAspect, aspects.lead, content);
    const other = personCrop(slot, others, sourceAspect, aspects.other, content);
    if (!lead || !other) return null;
    crops.set(slot.id, { lead, other });
  }
  return { mode: "split", crops };
}

/**
 * Replaces one regular layout sample with the conversation layout. `key`
 * changes exactly when the picture changes (lead swap, entering or leaving
 * the conversation), so the caller can mark that sample as a hard edit.
 */
export function conversationLayoutSample(
  base: ClipperLayoutSample,
  span: ConversationSpan,
  layout: ConversationLayout,
): { sample: ClipperLayoutSample; key: string } {
  const spanKey = `conversation:${span.start}`;
  const common = {
    requiredRegionIds: span.slots.map((slot) => slot.id),
    coverageBoxes: span.slots.map((slot) => ({ ...slot.faceBox })),
    candidateVariants: undefined,
    baselineRequiredCoverage: undefined,
    selectedRequiredCoverage: undefined,
    visibilityRisk: false,
    qualityTelemetry: undefined,
  } satisfies Partial<ClipperLayoutSample>;
  if (layout.mode !== "split" || !layout.crops) {
    const viewport = { ...layout.shared! };
    return {
      key: spanKey,
      sample: {
        ...base,
        ...common,
        mode: "single-crop",
        strategy: "semantic-single",
        viewports: [viewport],
        candidateMode: "single-crop",
        candidateViewports: [{ ...viewport }],
        primaryRegionId: undefined,
        panelSubjects: undefined,
        reasonCodes: ["conversation-layout", "conversation-shared-crop"],
      },
    };
  }
  const leadId = conversationLeadAt(span, base.t);
  const lead = span.slots.find((slot) => slot.id === leadId) ?? span.slots[0]!;
  const ordered = [lead, ...span.slots.filter((slot) => slot.id !== lead.id)];
  const viewports = ordered.map((slot, index) => {
    const crops = layout.crops!.get(slot.id)!;
    return { ...(index === 0 ? crops.lead : crops.other) };
  });
  return {
    key: `${spanKey}:${lead.id}`,
    sample: {
      ...base,
      ...common,
      mode: "split",
      strategy: ordered.length === 3 ? "semantic-split-3" : "semantic-split",
      viewports,
      candidateMode: "split",
      candidateViewports: viewports.map((viewport) => ({ ...viewport })),
      primaryRegionId: lead.id,
      panelSubjects: ordered.map((slot) => ({ id: slot.id, focusBox: { ...slot.faceBox } })),
      reasonCodes: ["conversation-layout"],
    },
  };
}

/** The participant holding the lead panel at `time`. */
export function conversationLeadAt(span: ConversationSpan, time: number): string {
  let lead = span.leads[0]!.slotId;
  for (const entry of span.leads) {
    if (entry.time > time + EPSILON) break;
    lead = entry.slotId;
  }
  return lead;
}
