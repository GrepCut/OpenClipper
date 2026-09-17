import { useCallback, useState } from "react";
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
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

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
  }, [active, exportId, graphRef, liveNodesRef]);

  const clearPosition = useCallback(() => {
    setPosition(null);
  }, []);

  return {
    position,
    updatePosition,
    clearPosition,
  };
}
