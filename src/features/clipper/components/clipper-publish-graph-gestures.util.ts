export const PUBLISH_GRAPH_PAN_THRESHOLD_PX = 5;
export const PUBLISH_GRAPH_MIN_ZOOM = 0.15;
export const PUBLISH_GRAPH_MAX_ZOOM = 8;
export const PUBLISH_GRAPH_WHEEL_SENSITIVITY = 0.01;
export const PUBLISH_GRAPH_ZOOM_DELTA_CLAMP = 10;
export const PUBLISH_GRAPH_ZOOM_STEP = 1.25;
export const PUBLISH_GRAPH_ZOOM_STEP_MS = 160;
export const PUBLISH_GRAPH_FIT_MS = 300;
export const PUBLISH_GRAPH_FIT_PADDING_PX = 72;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;
const MOUSE_WHEEL_DELTA_PX = 50;
const MOUSE_WHEEL_MAX_DELTA_X = 0.5;

export interface GraphPoint {
  x: number;
  y: number;
}

export type PublishGraphWheelGesture = "zoom" | "pan";
export type PublishGraphZoomAction = "zoom-in" | "zoom-out" | "fit";

export interface WheelGestureInput {
  ctrlKey: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

export function pointerDistancePx(from: GraphPoint, to: GraphPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function isPanPastThreshold(
  distancePx: number,
  thresholdPx = PUBLISH_GRAPH_PAN_THRESHOLD_PX,
): boolean {
  return distancePx > thresholdPx;
}

export function normalizeWheelDeltaPx(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PX;
  return delta;
}

export function classifyWheelGesture(event: WheelGestureInput): PublishGraphWheelGesture {
  if (event.ctrlKey || event.metaKey || event.altKey) return "zoom";
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (absX < MOUSE_WHEEL_MAX_DELTA_X && (event.deltaMode === 1 || absY >= MOUSE_WHEEL_DELTA_PX)) {
    return "zoom";
  }
  return "pan";
}

export function clampWheelZoomDelta(deltaY: number): number {
  return Math.max(-PUBLISH_GRAPH_ZOOM_DELTA_CLAMP, Math.min(PUBLISH_GRAPH_ZOOM_DELTA_CLAMP, deltaY));
}

export function clampPublishGraphZoom(zoom: number): number {
  return Math.min(PUBLISH_GRAPH_MAX_ZOOM, Math.max(PUBLISH_GRAPH_MIN_ZOOM, zoom));
}

export function centerFromPointerPan(
  startCenter: GraphPoint,
  startPointer: GraphPoint,
  currentPointer: GraphPoint,
  zoom: number,
): GraphPoint {
  const scale = zoom || 1;
  return {
    x: startCenter.x - (currentPointer.x - startPointer.x) / scale,
    y: startCenter.y - (currentPointer.y - startPointer.y) / scale,
  };
}

export function centerFromWheelPan(
  center: GraphPoint,
  deltaX: number,
  deltaY: number,
  zoom: number,
): GraphPoint {
  const scale = zoom || 1;
  return {
    x: center.x + deltaX / scale,
    y: center.y + deltaY / scale,
  };
}

export function nextZoomFromWheel(currentZoom: number, deltaY: number): number {
  return clampPublishGraphZoom(
    currentZoom * Math.pow(2, -deltaY * PUBLISH_GRAPH_WHEEL_SENSITIVITY),
  );
}

export function centerForZoomToPoint(
  center: GraphPoint,
  currentZoom: number,
  nextZoom: number,
  pointerGraph: GraphPoint,
): GraphPoint {
  if (nextZoom === 0) return center;
  const ratio = currentZoom / nextZoom;
  return {
    x: pointerGraph.x - (pointerGraph.x - center.x) * ratio,
    y: pointerGraph.y - (pointerGraph.y - center.y) * ratio,
  };
}

export function nextZoomFromStep(currentZoom: number, action: "zoom-in" | "zoom-out"): number {
  const factor = action === "zoom-in" ? PUBLISH_GRAPH_ZOOM_STEP : 1 / PUBLISH_GRAPH_ZOOM_STEP;
  return clampPublishGraphZoom(currentZoom * factor);
}

export interface ZoomShortcutInput {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function zoomActionFromShortcut(event: ZoomShortcutInput): PublishGraphZoomAction | null {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    if (event.code === "Equal" || event.code === "NumpadAdd") return "zoom-in";
    if (event.code === "Minus" || event.code === "NumpadSubtract") return "zoom-out";
    return null;
  }
  if (!mod && !event.altKey && event.shiftKey && event.code === "KeyZ") return "fit";
  return null;
}

export const TOUCHPAD_GESTURE_EVENT = "touchpad-gesture";
export const PUBLISH_GRAPH_TOUCHPAD_PX_PER_MM = 12;
export const TOUCHPAD_WHEEL_ECHO_QUIET_MS = 120;
export const PUBLISH_GRAPH_INERTIA_TIME_CONSTANT_MS = 325;
export const PUBLISH_GRAPH_INERTIA_MIN_SPEED = 0.02;
export const PUBLISH_GRAPH_INERTIA_SAMPLE_MS = 80;
const INERTIA_MAX_IDLE_BEFORE_LIFT_MS = 50;

export type TouchpadGestureEvent =
  | { kind: "contacts"; count: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "pinch"; ratio: number };

export interface PanSample {
  t: number;
  dx: number;
  dy: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

/** Screen-pixel velocity (px/ms) of the last pan samples, or null if the fingers had stopped. */
export function panReleaseVelocity(samples: PanSample[], now: number): Velocity | null {
  const recent = samples.filter((sample) => now - sample.t <= PUBLISH_GRAPH_INERTIA_SAMPLE_MS);
  const last = recent[recent.length - 1];
  if (!last || now - last.t > INERTIA_MAX_IDLE_BEFORE_LIFT_MS) return null;
  const elapsed = Math.max(16, now - recent[0].t);
  const vx = recent.reduce((sum, sample) => sum + sample.dx, 0) / elapsed;
  const vy = recent.reduce((sum, sample) => sum + sample.dy, 0) / elapsed;
  return Math.hypot(vx, vy) < PUBLISH_GRAPH_INERTIA_MIN_SPEED ? null : { vx, vy };
}

export function decayVelocity(velocity: Velocity, elapsedMs: number): Velocity {
  const factor = Math.exp(-elapsedMs / PUBLISH_GRAPH_INERTIA_TIME_CONSTANT_MS);
  return { vx: velocity.vx * factor, vy: velocity.vy * factor };
}

/** Content follows the fingers: the viewport center moves the opposite way. */
export function centerFromTouchpadPan(
  center: GraphPoint,
  dxPx: number,
  dyPx: number,
  zoom: number,
): GraphPoint {
  const scale = zoom || 1;
  return { x: center.x - dxPx / scale, y: center.y - dyPx / scale };
}
