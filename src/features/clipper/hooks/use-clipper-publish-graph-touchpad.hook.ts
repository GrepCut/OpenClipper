import { useCallback, useEffect, useRef, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { isTauri } from "../../../shared/utils/platform.util";
import {
  centerForZoomToPoint,
  centerFromTouchpadPan,
  clampPublishGraphZoom,
  decayVelocity,
  panReleaseVelocity,
  PUBLISH_GRAPH_INERTIA_MIN_SPEED,
  PUBLISH_GRAPH_INERTIA_SAMPLE_MS,
  PUBLISH_GRAPH_TOUCHPAD_PX_PER_MM,
  TOUCHPAD_GESTURE_EVENT,
  TOUCHPAD_WHEEL_ECHO_QUIET_MS,
  type PanSample,
  type TouchpadGestureEvent,
  type Velocity,
} from "../components/clipper-publish-graph-gestures.util";

interface UseClipperPublishGraphTouchpadOptions {
  containerRef: RefObject<HTMLElement | null>;
  graphRef: RefObject<ForceGraphMethods | undefined>;
  hoverClientRef: RefObject<{ x: number; y: number } | null>;
}

function canvasLocalPoint(container: HTMLElement, clientX: number, clientY: number) {
  const canvas = container.querySelector("canvas");
  const rect = (canvas ?? container).getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * Two-finger pan and pinch come from the native recognizer in
 * src-tauri/src/app/touchpad_gestures.rs (WebView2 never delivers touchpad pinch).
 * Mouse input stays in the DOM handlers.
 */
export function useClipperPublishGraphTouchpad({
  containerRef,
  graphRef,
  hoverClientRef,
}: UseClipperPublishGraphTouchpadOptions) {
  const fingersRef = useRef(0);
  const wheelEchoUntilRef = useRef(0);
  const panSamplesRef = useRef<PanSample[]>([]);
  const lastKindRef = useRef<"pan" | "pinch" | null>(null);
  const inertiaFrameRef = useRef(0);

  const cancelInertia = useCallback(() => {
    if (inertiaFrameRef.current) cancelAnimationFrame(inertiaFrameRef.current);
    inertiaFrameRef.current = 0;
  }, []);

  /** True for wheel events Windows synthesizes from a two-finger pan we already handled. */
  const isTouchpadWheelEcho = useCallback(() => {
    if (fingersRef.current >= 2) return true;
    const now = performance.now();
    if (now >= wheelEchoUntilRef.current) return false;
    wheelEchoUntilRef.current = now + TOUCHPAD_WHEEL_ECHO_QUIET_MS;
    return true;
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const panBy = (dxPx: number, dyPx: number) => {
      const fg = graphRef.current;
      const center = fg?.centerAt();
      if (!fg || !center) return false;
      const next = centerFromTouchpadPan(center, dxPx, dyPx, fg.zoom() || 1);
      fg.centerAt(next.x, next.y, 0);
      return true;
    };

    const startInertia = (initial: Velocity) => {
      cancelInertia();
      let velocity = initial;
      let previous = performance.now();
      const step = (now: number) => {
        const elapsed = Math.max(0, now - previous);
        previous = now;
        velocity = decayVelocity(velocity, elapsed);
        if (Math.hypot(velocity.vx, velocity.vy) < PUBLISH_GRAPH_INERTIA_MIN_SPEED) {
          inertiaFrameRef.current = 0;
          return;
        }
        if (!panBy(velocity.vx * elapsed, velocity.vy * elapsed)) {
          inertiaFrameRef.current = 0;
          return;
        }
        inertiaFrameRef.current = requestAnimationFrame(step);
      };
      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    const onContacts = (count: number) => {
      const previous = fingersRef.current;
      fingersRef.current = count;
      if (count > previous) {
        // A new touch catches the map, like on macOS.
        cancelInertia();
        panSamplesRef.current = [];
        lastKindRef.current = null;
        return;
      }
      if (previous >= 2 && count < 2) {
        wheelEchoUntilRef.current = performance.now() + TOUCHPAD_WHEEL_ECHO_QUIET_MS;
        const velocity = lastKindRef.current === "pan"
          ? panReleaseVelocity(panSamplesRef.current, performance.now())
          : null;
        panSamplesRef.current = [];
        lastKindRef.current = null;
        if (velocity) startInertia(velocity);
      }
    };

    const onPan = (dxMm: number, dyMm: number) => {
      if (!hoverClientRef.current) return;
      const dx = dxMm * PUBLISH_GRAPH_TOUCHPAD_PX_PER_MM;
      const dy = dyMm * PUBLISH_GRAPH_TOUCHPAD_PX_PER_MM;
      if (!panBy(dx, dy)) return;
      lastKindRef.current = "pan";
      const now = performance.now();
      const samples = panSamplesRef.current;
      samples.push({ t: now, dx, dy });
      while (samples.length && now - samples[0].t > PUBLISH_GRAPH_INERTIA_SAMPLE_MS) samples.shift();
    };

    const onPinch = (ratio: number) => {
      const element = containerRef.current;
      const hover = hoverClientRef.current;
      const fg = graphRef.current;
      const center = fg?.centerAt();
      // Only act while the cursor is over the map, like Final Cut's timeline.
      if (!element || !hover || !fg || !center || !(ratio > 0)) return;
      lastKindRef.current = "pinch";
      const zoom = fg.zoom() || 1;
      const nextZoom = clampPublishGraphZoom(zoom * ratio);
      if (nextZoom === zoom) return;
      const pointer = canvasLocalPoint(element, hover.x, hover.y);
      const pointerGraph = fg.screen2GraphCoords(pointer.x, pointer.y);
      const nextCenter = centerForZoomToPoint(center, zoom, nextZoom, pointerGraph);
      fg.zoom(nextZoom, 0);
      fg.centerAt(nextCenter.x, nextCenter.y, 0);
    };

    void listen<TouchpadGestureEvent>(TOUCHPAD_GESTURE_EVENT, ({ payload }) => {
      if (payload.kind === "contacts") onContacts(payload.count);
      else if (payload.kind === "pan") onPan(payload.dx, payload.dy);
      else if (payload.kind === "pinch") onPinch(payload.ratio);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
      cancelInertia();
    };
  }, [cancelInertia, containerRef, graphRef, hoverClientRef]);

  return { isTouchpadWheelEcho, cancelInertia };
}
