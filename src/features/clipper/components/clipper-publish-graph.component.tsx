import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Box } from "@chakra-ui/react";
import { asset } from "../../../shared/utils/asset.util";
import { useClipperPublishGraphThumbnails } from "../hooks/use-clipper-publish-graph-thumbnails.hook";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperPlatform } from "../shared/formats.util";
import type { PublishGraphData, PublishGraphNode } from "../shared/clipper-publish-graph.util";
import {
  drawExportNode,
  drawOwnerNode,
  drawProjectNode,
  paintNodeHitArea,
} from "./clipper-publish-graph-draw.util";

const PROJECT_LINK_DISTANCE = 200;
const CHARGE_STRENGTH = -560;

const PLATFORM_LOGO: Record<ClipperPlatform, string> = {
  youtube: asset("/clipper/youtube-logo.webp"),
  instagram: asset("/clipper/instagram-logo.webp"),
  tiktok: asset("/clipper/tiktok-logo.webp"),
  twitter: asset("/clipper/x-logo.webp"),
};

const logoCache = new Map<ClipperPlatform, HTMLImageElement>();

function loadPlatformLogo(platform: ClipperPlatform): HTMLImageElement | null {
  const cached = logoCache.get(platform);
  if (cached?.complete) return cached;

  const img = cached ?? new Image();
  if (!cached) {
    img.src = PLATFORM_LOGO[platform];
    logoCache.set(platform, img);
  }
  return img.complete ? img : null;
}

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
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setDimensions({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(320, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const graphPayload = useMemo(
    () => ({
      nodes: graphData.nodes.map((node) => ({
        ...node,
        val: node.type === "owner" ? 18 : node.type === "project" ? 14 : 4,
      })),
      links: graphData.links.map((link) => ({ ...link })),
    }),
    [graphData],
  );

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
  }, [graphPayload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(400, 72);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [graphData.nodes.length]);

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
        (platform) => (platform ? loadPlatformLogo(platform) : null),
      );
    },
    [selectedExportId, selectedOwnerId, selectedProjectId, theme, thumbnails],
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
          const published = n.isPublished ? " · Published" : "";
          return `${n.label}${published}`;
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
