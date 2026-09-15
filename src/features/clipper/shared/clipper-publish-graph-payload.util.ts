import type {
  PublishGraphData,
  PublishGraphLink,
  PublishGraphNode,
} from "./clipper-publish-graph.util";

const NODE_VAL: Record<PublishGraphNode["type"], number> = {
  owner: 18,
  project: 14,
  export: 4,
};

export interface PublishGraphSimNode extends PublishGraphNode {
  val: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

export interface PublishGraphPayload {
  nodes: PublishGraphSimNode[];
  links: PublishGraphLink[];
}

export function publishGraphTopologyKey(graphData: PublishGraphData): string {
  const nodes = graphData.nodes.map((node) => node.id).sort().join("\u0000");
  const links = graphData.links
    .map((link) => `${link.source}\u0000${link.target}`)
    .sort()
    .join("\u0001");
  return `${nodes}\u0001${links}`;
}

export function buildPublishGraphPayload(
  graphData: PublishGraphData,
  previousNodes: PublishGraphSimNode[],
): PublishGraphPayload {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]));

  return {
    nodes: graphData.nodes.map((node) => {
      const next: PublishGraphSimNode = {
        ...node,
        val: NODE_VAL[node.type],
      };
      const prior = previousById.get(node.id);
      if (prior == null || prior.x == null || prior.y == null) return next;
      next.x = prior.x;
      next.y = prior.y;
      next.vx = prior.vx;
      next.vy = prior.vy;
      next.fx = prior.fx;
      next.fy = prior.fy;
      return next;
    }),
    links: graphData.links.map((link) => ({ ...link })),
  };
}
