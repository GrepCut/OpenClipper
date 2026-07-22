import {
  defaultContainRect,
  defaultTargetRect,
} from "../benchmark/target-geometry.util";
import type { TestClip, TestKeyframe, TestLayoutIntent, TestTarget } from "../test.types";

export const TARGET_COLORS = ["#22D3EE", "#F472B6"];
export const CONTAIN_COLOR = "#FBBF24";
export const KEYFRAME_TIME_TOLERANCE_US = 1_000;

export function formatTime(time: number): string {
  return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}.${Math.floor((time % 1) * 10)}`;
}

export function freshTarget(slot: 0 | 1, clip: TestClip, x = 0.5, y = 0.5): TestTarget {
  const rect = defaultTargetRect(clip.width, clip.height, x, y);
  return { id: crypto.randomUUID(), slot, ...rect };
}

export function freshContainTarget(clip: TestClip): TestTarget {
  const rect = defaultContainRect(clip.width, clip.height);
  return { id: crypto.randomUUID(), slot: 0, ...rect };
}

export function buildKeyframe(
  time: number,
  targets: TestTarget[],
  layoutIntent: TestLayoutIntent,
  frames: TestKeyframe[],
  clipDuration?: number,
): TestKeyframe {
  const timestampUs = Math.min(
    Math.round((clipDuration ?? time) * 1_000_000),
    Math.max(0, Math.round(time * 1_000_000)),
  );
  const existing = frames.find((frame) => Math.abs(frame.timestampUs - timestampUs) <= KEYFRAME_TIME_TOLERANCE_US);
  return {
    id: existing?.id ?? crypto.randomUUID(),
    timestampUs,
    layoutIntent,
    targets: targets.map((target, index) => ({
      ...target,
      id: existing?.targets[index]?.id ?? crypto.randomUUID(),
      slot: index as 0 | 1,
    })),
  };
}

export const CROP_HELPER_TEXT =
  "Drag to pan, corner handle to zoom. Boxes are always 9:16.";
export const CONTAIN_HELPER_TEXT =
  "Drag to pan, corner handle to resize freely. Shows what should be visible (contain).";
