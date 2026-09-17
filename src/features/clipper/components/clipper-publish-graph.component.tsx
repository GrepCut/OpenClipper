import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Box } from "@chakra-ui/react";
import { useClipperPublishGraphThumbnails } from "../hooks/use-clipper-publish-graph-thumbnails.hook";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { getExportNodeStatusLabel } from "../persistence/clipper-export-social.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { PublishGraphData, PublishGraphNode } from "../shared/clipper-publish-graph.util";
import {
  buildPublishGraphPayload,
  publishGraphTopologyKey,
  type PublishGraphSimNode,
} from "../shared/clipper-publish-graph-payload.util";
import {
  drawExportNode,
  drawOwnerNode,
  drawProjectNode,
  paintNodeHitArea,
} from "./clipper-publish-graph-draw.util";
import { loadPlatformLogo } from "./clipper-publish-graph-logos.util";

const PROJECT_LINK_DISTANCE = 200;
const CHARGE_STRENGTH = -560;
const RESIZE_EPSILON_PX = 2;

interface ClipperPublishGraphProps {
  graphData: PublishGraphData;
  items: ClipperExportMapItem[];
  selectedExportId: string | null;
  selectedProjectId: string | null;
  selectedOwnerId: string | null;
  onNodeClick: (nodeId: string | null, nodeType?: PublishGraphNode["type"]) => void;
  connectedSplit?: boolean;
}

export function ClipperPublishGraph({
  graphData,
  items,
  selectedExportId,
  selectedProjectId,
  selectedOwnerId,
  onNodeClick,
  connectedSplit = false,
}: ClipperPublishGraphProps) {
  const { theme } = useClipperUi();
  const { thumbnails } = useClipperPublishGraphThumbnails(items);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const liveNodesRef = useRef<PublishGraphSimNode[]>([]);
  const dimensionsRef = useRef({ width: 640, height: 480 });
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  const [logoVersion, setLogoVersion] = useState(0);

  const onLogoReady = useCallback(() => {
    setLogoVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(320, entry.contentRect.width);
      const height = Math.max(320, entry.contentRect.height);
      const previous = dimensionsRef.current;
      if (
        Math.abs(width - previous.width) < RESIZE_EPSILON_PX
        && Math.abs(height - previous.height) < RESIZE_EPSILON_PX
      ) {
        return;
      }
      dimensionsRef.current = { width, height };
      setDimensions({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const topologyKey = useMemo(() => publishGraphTopologyKey(graphData), [graphData]);

  const graphPayload = useMemo(
    () => buildPublishGraphPayload(graphData, liveNodesRef.current),
    [graphData],
  );

  useEffect(() => {
    liveNodesRef.current = graphPayload.nodes;
  }, [graphPayload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fg = graphRef.current;
      if (!fg) return;

      const linkForce = fg.d3Force("link");
      if (linkForce) {
        linkForce.distance(PROJECT_LINK_DISTANCE);
      }

      const chargeForce = fg.d3Force("charge");
      if (chargeForce) {
        chargeForce.strength(CHARGE_STRENGTH);
      }

      fg.d3ReheatSimulation();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [topologyKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(400, 72);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [topologyKey]);

  const drawNode = useCallback(
    (node: PublishGraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (node.type === "owner") {
        drawOwnerNode(
          node,
          ctx,
          globalScale,
          theme,
          node.ownerId === selectedOwnerId,
        );
        return;
      }
      if (node.type === "project") {
        const thumbnail = node.projectId ? thumbnails[node.projectId] : undefined;
        drawProjectNode(
          node,
          ctx,
          globalScale,
          theme,
          thumbnail,
          node.projectId === selectedProjectId,
        );
        return;
      }
      drawExportNode(
        node,
        ctx,
        globalScale,
        theme,
        selectedExportId,
        (platform) => (platform ? loadPlatformLogo(platform, onLogoReady) : null),
      );
    },
    [
      logoVersion,
      onLogoReady,
      selectedExportId,
      selectedOwnerId,
      selectedProjectId,
      theme,
      thumbnails,
    ],
  );

  return (
    <Box
      ref={containerRef}
      flex="1"
      minH="320px"
      h="full"
      borderRadius={connectedSplit ? 0 : "2xl"}
      border={connectedSplit ? "none" : "1px solid"}
      borderColor={theme.border.primary}
      bg={theme.background.card}
      overflow="hidden"
    >
      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphPayload}
        nodeLabel={(node) => {
          const n = node as PublishGraphNode;
          if (n.type === "project") return n.label;
          if (n.type === "owner") return n.label;
          const status = n.exportStatus ?? "incomplete";
          return `${n.label}${getExportNodeStatusLabel(status)}`;
        }}
        linkColor={() => theme.border.primary}
        linkWidth={1}
        cooldownTicks={120}
        d3VelocityDecay={0.35}
        onNodeClick={(node) => {
          const n = node as PublishGraphNode;
          onNodeClick(n.id, n.type);
        }}
        nodeCanvasObject={(node, ctx, globalScale) =>
          drawNode(node as PublishGraphNode, ctx, globalScale)
        }
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as PublishGraphNode;
          const thumbnail = n.type === "project" && n.projectId
            ? thumbnails[n.projectId]
            : undefined;
          paintNodeHitArea(n, color, ctx, thumbnail);
        }}
      />
    </Box>
  );
}
