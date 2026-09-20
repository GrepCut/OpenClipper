import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import {
  centerForZoomToPoint,
  centerFromPointerPan,
  centerFromWheelPan,
  classifyWheelGesture,
  clampWheelZoomDelta,
  isPanPastThreshold,
  nextZoomFromWheel,
  nextZoomFromStep,
  normalizeWheelDeltaPx,
  pointerDistancePx,
  PUBLISH_GRAPH_FIT_MS,
  PUBLISH_GRAPH_FIT_PADDING_PX,
  PUBLISH_GRAPH_ZOOM_STEP_MS,
  zoomActionFromShortcut,
  type PublishGraphZoomAction,
} from "../components/clipper-publish-graph-gestures.util";
import { isEditableKeyboardTarget } from "./use-clipper-publish-export-delete.hook";
import { useClipperPublishGraphTouchpad } from "./use-clipper-publish-graph-touchpad.hook";

interface PointerPanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCenterX: number;
  startCenterY: number;
  panning: boolean;
}

interface UseClipperPublishGraphGesturesOptions {
  containerRef: RefObject<HTMLElement | null>;
  graphRef: RefObject<ForceGraphMethods | undefined>;
  hitsNodeRef: RefObject<(point: { x: number; y: number }) => boolean>;
  deleteConfirmArmed: boolean;
  onCancelDeleteConfirm?: () => void;
}

function canvasLocalPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const canvas = container.querySelector("canvas");
  const rect = (canvas ?? container).getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function setCanvasPanCursor(container: HTMLElement, cursor: "grab" | "grabbing" | "") {
  container.style.cursor = cursor;
  const canvas = container.querySelector("canvas");
  if (canvas instanceof HTMLElement) canvas.style.cursor = cursor;
}

export function useClipperPublishGraphGestures({
  containerRef,
  graphRef,
  hitsNodeRef,
  deleteConfirmArmed,
  onCancelDeleteConfirm,
}: UseClipperPublishGraphGesturesOptions) {
  const ignoreNodeClickRef = useRef(false);
  const panStateRef = useRef<PointerPanState | null>(null);
  const hoverClientRef = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(deleteConfirmArmed);
  const cancelRef = useRef(onCancelDeleteConfirm);
  armedRef.current = deleteConfirmArmed;
  cancelRef.current = onCancelDeleteConfirm;

  const { isTouchpadWheelEcho, cancelInertia } = useClipperPublishGraphTouchpad({
    containerRef,
    graphRef,
    hoverClientRef,
  });

  const shouldIgnoreNodeClick = useCallback(() => ignoreNodeClickRef.current, []);

  const applyZoomAction = useCallback((action: PublishGraphZoomAction) => {
    const fg = graphRef.current;
    if (!fg) return;
    if (action === "fit") {
      fg.zoomToFit(PUBLISH_GRAPH_FIT_MS, PUBLISH_GRAPH_FIT_PADDING_PX);
      return;
    }
    fg.zoom(nextZoomFromStep(fg.zoom() || 1, action), PUBLISH_GRAPH_ZOOM_STEP_MS);
  }, [graphRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      const action = zoomActionFromShortcut(event);
      if (!action) return;
      event.preventDefault();
      applyZoomAction(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyZoomAction]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const graph = () => graphRef.current;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!(event.target instanceof HTMLCanvasElement)) return;
      cancelInertia();
      const fg = graph();
      const center = fg?.centerAt();
      if (!fg || !center) return;
      const pointer = canvasLocalPoint(element, event.clientX, event.clientY);
      const graphPoint = fg.screen2GraphCoords(pointer.x, pointer.y);
      if (hitsNodeRef.current(graphPoint)) return;
      panStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCenterX: center.x,
        startCenterY: center.y,
        panning: false,
      };
      setCanvasPanCursor(element, "grab");
    };

    const onPointerMove = (event: PointerEvent) => {
      hoverClientRef.current = { x: event.clientX, y: event.clientY };
      const state = panStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const fg = graph();
      if (!fg) return;
      const distance = pointerDistancePx(
        { x: state.startClientX, y: state.startClientY },
        { x: event.clientX, y: event.clientY },
      );
      if (!state.panning && !isPanPastThreshold(distance)) return;
      if (!state.panning) {
        state.panning = true;
        element.setPointerCapture(event.pointerId);
        document.body.style.cursor = "grabbing";
        setCanvasPanCursor(element, "grabbing");
      }
      const next = centerFromPointerPan(
        { x: state.startCenterX, y: state.startCenterY },
        { x: state.startClientX, y: state.startClientY },
        { x: event.clientX, y: event.clientY },
        fg.zoom() || 1,
      );
      fg.centerAt(next.x, next.y, 0);
    };

    const finishPointer = (event: PointerEvent) => {
      const state = panStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      panStateRef.current = null;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      document.body.style.cursor = "";
      setCanvasPanCursor(element, "");
      if (state.panning) {
        ignoreNodeClickRef.current = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            ignoreNodeClickRef.current = false;
          });
        });
        return;
      }
      if (armedRef.current) cancelRef.current?.();
    };

    const onWheel = (event: WheelEvent) => {
      const fg = graph();
      const center = fg?.centerAt();
      if (!fg || !center) return;
      event.preventDefault();
      const modified = event.ctrlKey || event.metaKey || event.altKey;
      if (!modified && isTouchpadWheelEcho()) return;
      cancelInertia();
      const zoom = fg.zoom() || 1;
      if (classifyWheelGesture(event) === "zoom") {
        const deltaY = clampWheelZoomDelta(normalizeWheelDeltaPx(event.deltaY, event.deltaMode));
        const nextZoom = nextZoomFromWheel(zoom, deltaY);
        if (nextZoom === zoom) return;
        const pointer = canvasLocalPoint(element, event.clientX, event.clientY);
        const pointerGraph = fg.screen2GraphCoords(pointer.x, pointer.y);
        const nextCenter = centerForZoomToPoint(center, zoom, nextZoom, pointerGraph);
        fg.zoom(nextZoom, 0);
        fg.centerAt(nextCenter.x, nextCenter.y, 0);
        return;
      }
      const deltaX = normalizeWheelDeltaPx(event.deltaX, event.deltaMode);
      const deltaY = normalizeWheelDeltaPx(event.deltaY, event.deltaMode);
      const next = centerFromWheelPan(center, deltaX, deltaY, zoom);
      fg.centerAt(next.x, next.y, 0);
    };

    const onPointerLeave = () => {
      hoverClientRef.current = null;
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerleave", onPointerLeave);
    element.addEventListener("pointerup", finishPointer);
    element.addEventListener("pointercancel", finishPointer);
    element.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.removeEventListener("pointerup", finishPointer);
      element.removeEventListener("pointercancel", finishPointer);
      element.removeEventListener("wheel", onWheel, { capture: true });
      document.body.style.cursor = "";
      setCanvasPanCursor(element, "");
    };
  }, [cancelInertia, containerRef, graphRef, hitsNodeRef, isTouchpadWheelEcho]);

  return { shouldIgnoreNodeClick, applyZoomAction };
}
