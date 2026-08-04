import { invoke } from "@tauri-apps/api/core";
import { getBadgePlatformsForFormat, getClipperFormatDef } from "../shared/formats.util";
import type { ClipperPlatform } from "../shared/formats.util";
import type { ClipperFormatResult } from "../shared/state.util";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { pathBackedClipperFile } from "../platform/native-source.util";
import { resolveFilePlayableUrl } from "../persistence/tauri-media.util";
import { fitFrameSize } from "../lib/media/video-thumbnail-canvas.util";

export const PROJECT_THUMB_MAX_DIMENSION = 84;

export type PublishSelection =
  | { kind: "none" }
  | { kind: "export"; exportId: string }
  | { kind: "project"; projectId: string }
  | { kind: "owner"; ownerId: string };

export interface PublishGraphNode {
  id: string;
  type: "owner" | "project" | "export";
  label: string;
  ownerId?: string;
  projectId?: string;
  projectName?: string;
  clipperOwnerId?: string | null;
  clipperOwnerName?: string | null;
  clipIndex?: number;
  formatId?: string;
  platform?: ClipperPlatform;
  badgePlatforms?: ClipperPlatform[];
  isPublished?: boolean;
  exportItem?: ClipperExportMapItem;
  thumbWidth?: number;
  thumbHeight?: number;
  x?: number;
  y?: number;
}

export interface PublishGraphLink {
  source: string;
  target: string;
  type: "owner-project" | "project-export";
}

const EXPORT_ORBIT_RADIUS = 155;
const OWNER_CLUSTER_SPACING = 520;
const OWNER_PROJECT_DISTANCE = 130;
const UNASSIGNED_PROJECT_SPACING = 360;

function hashLayoutSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash || 1;
}

function createLayoutRandom(nodes: PublishGraphNode[]): () => number {
  const seed = hashLayoutSeed(nodes.map((node) => node.id).sort().join("|"));
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0xffffffff;
  };
}

function randomInRange(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function layoutProjectExports(
  nodes: PublishGraphNode[],
  project: PublishGraphNode,
  centerX: number,
  centerY: number,
  random: () => number,
): void {
  project.x = centerX;
  project.y = centerY;

  const exports = nodes.filter(
    (node) => node.type === "export" && node.projectId === project.projectId,
  );
  exports.forEach((exportNode, index) => {
    const angleJitter = exports.length > 1 ? randomInRange(random, -0.35, 0.35) : random() * 2 * Math.PI;
    const angle = exports.length > 0
      ? (2 * Math.PI * index) / exports.length - Math.PI / 2 + angleJitter
      : angleJitter;
    const orbitRadius = EXPORT_ORBIT_RADIUS * randomInRange(random, 0.82, 1.18);
    exportNode.x = centerX + Math.cos(angle) * orbitRadius;
    exportNode.y = centerY + Math.sin(angle) * orbitRadius;
  });
}

function applyStarLayout(nodes: PublishGraphNode[]): void {
  const random = createLayoutRandom(nodes);
  const owners = nodes.filter((node) => node.type === "owner");
  const projects = nodes.filter((node) => node.type === "project");
  const assignedProjects = projects.filter((project) => project.clipperOwnerId);
  const unassignedProjects = projects.filter((project) => !project.clipperOwnerId);
  const globalRotation = random() * 2 * Math.PI;

  owners.forEach((owner, ownerIndex) => {
    const clusterAngle = owners.length > 1
      ? (2 * Math.PI * ownerIndex) / owners.length + globalRotation
      : random() * 2 * Math.PI;
    const ownerDistance = owners.length > 1
      ? OWNER_CLUSTER_SPACING * randomInRange(random, 0.82, 1.12)
      : OWNER_CLUSTER_SPACING * randomInRange(random, 0.28, 0.55);
    const ownerX = Math.cos(clusterAngle) * ownerDistance;
    const ownerY = Math.sin(clusterAngle) * ownerDistance;

    owner.x = ownerX;
    owner.y = ownerY;

    const ownerProjects = assignedProjects.filter(
      (project) => project.clipperOwnerId === owner.ownerId,
    );
    ownerProjects.forEach((project, projectIndex) => {
      const spreadAngle = ownerProjects.length > 1
        ? (2 * Math.PI * projectIndex) / ownerProjects.length + randomInRange(random, -0.45, 0.45)
        : random() * 2 * Math.PI;
      const projectDistance = OWNER_PROJECT_DISTANCE * randomInRange(random, 0.78, 1.28);
      const projectX = ownerX + Math.cos(spreadAngle) * projectDistance;
      const projectY = ownerY + Math.sin(spreadAngle) * projectDistance;
      layoutProjectExports(nodes, project, projectX, projectY, random);
    });
  });

  unassignedProjects.forEach((project, projectIndex) => {
    const clusterAngle = unassignedProjects.length > 1
      ? (2 * Math.PI * projectIndex) / unassignedProjects.length + globalRotation
      : random() * 2 * Math.PI;
    const clusterDistance = UNASSIGNED_PROJECT_SPACING * randomInRange(random, 0.75, 1.15);
    const clusterCx = Math.cos(clusterAngle) * clusterDistance;
    const clusterCy = Math.sin(clusterAngle) * clusterDistance;
    layoutProjectExports(nodes, project, clusterCx, clusterCy, random);
  });
}

export interface PublishGraphData {
  nodes: PublishGraphNode[];
  links: PublishGraphLink[];
}

/** One representative export per project — lowest clip index wins. */
export function pickProjectCoverExports(
  items: ClipperExportMapItem[],
): Record<string, ClipperExportMapItem> {
  const byProject: Record<string, ClipperExportMapItem> = {};
  for (const item of items) {
    const current = byProject[item.projectId];
    if (!current || item.clipIndex < current.clipIndex) {
      byProject[item.projectId] = item;
      continue;
    }
    if (item.clipIndex === current.clipIndex && item.exportedAt > current.exportedAt) {
      byProject[item.projectId] = item;
    }
  }
  return byProject;
}

export function mapItemToFormatResult(
  item: ClipperExportMapItem,
  previewUrl = "",
  filePath?: string,
  file?: File,
): ClipperFormatResult {
  const formatDef = getClipperFormatDef(item.formatId);
  return {
    id: item.id,
    formatId: item.formatId,
    platform: formatDef?.platform ?? "youtube",
    label: item.formatLabel,
    width: item.width,
    height: item.height,
    fileSize: item.fileSize,
    previewUrl,
    clipIndex: item.clipIndex,
    exportedAt: item.exportedAt,
    clipStartSec: item.clipStartSec,
    clipEndSec: item.clipEndSec,
    relativePath: item.relativePath,
    displayPath: filePath ?? item.relativePath,
    filePath,
    file,
    transcriptPlain: item.transcriptPlain,
    transcriptTimestamped: item.transcriptTimestamped,
    socialTitle: item.socialTitle,
    socialShortDescription: item.socialShortDescription,
    socialDescription: item.socialDescription,
    socialDescriptionTimestamped: item.socialDescriptionTimestamped,
    socialHashtags: item.socialHashtags,
    isMissing: !previewUrl,
  };
}

export async function resolveExportMapItemMedia(
  item: ClipperExportMapItem,
): Promise<ClipperFormatResult> {
  try {
    const filePath = await invoke<string>("get_clipper_export_file_path", {
      projectId: item.projectId,
      fileName: item.fileName,
    });
    const file = pathBackedClipperFile(filePath);
    const previewUrl = await resolveFilePlayableUrl(file);
    return mapItemToFormatResult(item, previewUrl, filePath, file);
  } catch {
    return mapItemToFormatResult(item, "", undefined, undefined);
  }
}

export function buildPublishGraphData(items: ClipperExportMapItem[]): PublishGraphData {
  const nodes: PublishGraphNode[] = [];
  const links: PublishGraphLink[] = [];
  const projectIds = new Set<string>();
  const ownerIds = new Set<string>();
  const projectOwners = new Map<string, { id: string; name: string }>();

  for (const item of items) {
    if (item.clipperOwnerId && item.clipperOwnerName) {
      projectOwners.set(item.projectId, {
        id: item.clipperOwnerId,
        name: item.clipperOwnerName,
      });
    }
  }

  for (const owner of projectOwners.values()) {
    if (ownerIds.has(owner.id)) continue;
    ownerIds.add(owner.id);
    nodes.push({
      id: `owner:${owner.id}`,
      type: "owner",
      label: owner.name,
      ownerId: owner.id,
    });
  }

  for (const item of items) {
    const formatDef = getClipperFormatDef(item.formatId);
    const projectNodeId = `project:${item.projectId}`;
    const owner = projectOwners.get(item.projectId);

    if (!projectIds.has(item.projectId)) {
      projectIds.add(item.projectId);
      nodes.push({
        id: projectNodeId,
        type: "project",
        label: item.projectName,
        projectId: item.projectId,
        projectName: item.projectName,
        clipperOwnerId: owner?.id ?? null,
        clipperOwnerName: owner?.name ?? null,
      });

      if (owner) {
        links.push({
          source: `owner:${owner.id}`,
          target: projectNodeId,
          type: "owner-project",
        });
      }
    }

    nodes.push({
      id: item.id,
      type: "export",
      label: item.formatLabel,
      projectId: item.projectId,
      projectName: item.projectName,
      clipperOwnerId: owner?.id ?? null,
      clipperOwnerName: owner?.name ?? null,
      clipIndex: item.clipIndex,
      formatId: item.formatId,
      platform: formatDef?.platform,
      badgePlatforms: getBadgePlatformsForFormat(item.formatId),
      isPublished: item.isPublished,
      exportItem: item,
    });

    links.push({
      source: projectNodeId,
      target: item.id,
      type: "project-export",
    });
  }

  const coverExports = pickProjectCoverExports(items);
  for (const node of nodes) {
    if (node.type !== "project" || !node.projectId) continue;
    const cover = coverExports[node.projectId];
    if (!cover) continue;
    const thumb = fitFrameSize(cover.width, cover.height, PROJECT_THUMB_MAX_DIMENSION);
    node.thumbWidth = thumb.width;
    node.thumbHeight = thumb.height;
  }

  applyStarLayout(nodes);

  return { nodes, links };
}
