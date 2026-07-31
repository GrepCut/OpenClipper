import { invoke } from "@tauri-apps/api/core";
import { getClipperFormatDef } from "../shared/formats.util";
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

function layoutProjectExports(
  nodes: PublishGraphNode[],
  project: PublishGraphNode,
  centerX: number,
  centerY: number,
): void {
  project.x = centerX;
  project.y = centerY;

  const exports = nodes.filter(
    (node) => node.type === "export" && node.projectId === project.projectId,
  );
  exports.forEach((exportNode, index) => {
    const angle = exports.length > 0
      ? (2 * Math.PI * index) / exports.length - Math.PI / 2
      : 0;
    exportNode.x = centerX + Math.cos(angle) * EXPORT_ORBIT_RADIUS;
    exportNode.y = centerY + Math.sin(angle) * EXPORT_ORBIT_RADIUS;
  });
}

function applyStarLayout(nodes: PublishGraphNode[]): void {
  const owners = nodes.filter((node) => node.type === "owner");
  const projects = nodes.filter((node) => node.type === "project");
  const assignedProjects = projects.filter((project) => project.clipperOwnerId);
  const unassignedProjects = projects.filter((project) => !project.clipperOwnerId);

  owners.forEach((owner, ownerIndex) => {
    const clusterAngle = owners.length > 1
      ? (2 * Math.PI * ownerIndex) / owners.length
      : 0;
    const ownerX = owners.length > 1
      ? Math.cos(clusterAngle) * OWNER_CLUSTER_SPACING
      : 0;
    const ownerY = owners.length > 1
      ? Math.sin(clusterAngle) * OWNER_CLUSTER_SPACING
      : -OWNER_PROJECT_DISTANCE * 1.4;

    owner.x = ownerX;
    owner.y = ownerY;

    const ownerProjects = assignedProjects.filter(
      (project) => project.clipperOwnerId === owner.ownerId,
    );
    ownerProjects.forEach((project, projectIndex) => {
      const spreadAngle = ownerProjects.length > 1
        ? (2 * Math.PI * projectIndex) / ownerProjects.length
        : Math.PI / 2;
      const projectX = ownerX + Math.cos(spreadAngle) * OWNER_PROJECT_DISTANCE;
      const projectY = ownerY + Math.sin(spreadAngle) * OWNER_PROJECT_DISTANCE;
      layoutProjectExports(nodes, project, projectX, projectY);
    });
  });

  unassignedProjects.forEach((project, projectIndex) => {
    const clusterAngle = unassignedProjects.length > 1
      ? (2 * Math.PI * projectIndex) / unassignedProjects.length
      : 0;
    const clusterCx = unassignedProjects.length > 1
      ? Math.cos(clusterAngle) * UNASSIGNED_PROJECT_SPACING
      : 0;
    const clusterCy = unassignedProjects.length > 1
      ? Math.sin(clusterAngle) * UNASSIGNED_PROJECT_SPACING
      : 0;
    layoutProjectExports(nodes, project, clusterCx, clusterCy);
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
