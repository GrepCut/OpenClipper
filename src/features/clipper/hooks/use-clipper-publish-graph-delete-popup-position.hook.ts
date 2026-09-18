import { useCallback, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { PublishGraphSimNode } from "../shared/clipper-publish-graph-payload.util";

interface UseClipperPublishGraphDeletePopupPositionOptions {
  graphRef: React.RefObject<ForceGraphMethods | undefined>;
  liveNodesRef: React.RefObject<PublishGraphSimNode[]>;
  exportId: string | null;
  active: boolean;
}

export function useClipperPublishGraphDeletePopupPosition({
  graphRef,
  liveNodesRef,
  exportId,
  active,
}: UseClipperPublishGraphDeletePopupPositionOptions) {
  const [position, setPositionState] = useState<{ x: number; y: number } | null>(null);
  const positionRef = useRef(position);

  // force-graph fires onZoom during its own render; skip no-op updates so React
  // does not warn about updating ClipperPublishGraph while rendering ForceGraph2D.
  const setPosition = useCallback((next: { x: number; y: number } | null) => {
    const previous = positionRef.current;
    if (previous === next) return;
    if (previous && next && previous.x === next.x && previous.y === next.y) return;
    positionRef.current = next;
    setPositionState(next);
  }, []);

  const updatePosition = useCallback(() => {
    if (!active || !exportId) {
      setPosition(null);
      return;
    }

    const graph = graphRef.current;
    const node = liveNodesRef.current.find((entry) => entry.id === exportId);
    if (!graph || !node || node.x == null || node.y == null) {
      setPosition(null);
      return;
    }

    const coords = graph.graph2ScreenCoords(node.x, node.y);
    setPosition({ x: coords.x, y: coords.y });
  }, [active, exportId, graphRef, liveNodesRef, setPosition]);

  const clearPosition = useCallback(() => {
    setPosition(null);
  }, [setPosition]);

  return {
    position,
    updatePosition,
    clearPosition,
  };
}
