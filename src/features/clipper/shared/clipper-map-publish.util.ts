import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";
import type {
  ClipperExportMapItem,
  ClipperExportPublishRecord,
} from "../persistence/clipper-export-db-api.util";
import { PLATFORM_LABELS } from "../components/clipper-social-publish-dialog.constants";
import { getPublishTargetsForFormat } from "./formats.util";

export const MAP_IN_APP_PUBLISH_PLATFORMS: readonly SocialPublishablePlatform[] = [
  "tiktok",
  "youtube",
];

const MAP_IN_APP_PUBLISH_PLATFORM_SET = new Set<string>(MAP_IN_APP_PUBLISH_PLATFORMS);
const mapPublishTargetsByFormat = new Map<string, readonly SocialPublishablePlatform[]>();

/** In-app publish targets for a format; empty means folder-only. Memoized per format id. */
export function getMapPublishTargets(formatId: string): readonly SocialPublishablePlatform[] {
  let targets = mapPublishTargetsByFormat.get(formatId);
  if (!targets) {
    targets = getPublishTargetsForFormat(formatId).filter((platform) =>
      MAP_IN_APP_PUBLISH_PLATFORM_SET.has(platform),
    );
    mapPublishTargetsByFormat.set(formatId, targets);
  }
  return targets;
}

export function isFolderOnlyFormat(formatId: string): boolean {
  return getMapPublishTargets(formatId).length === 0;
}

/** TikTok / YouTube first, folder-only platforms last, then clip index. */
export function compareMapPublishExports(
  a: Pick<ClipperExportMapItem, "formatId" | "clipIndex" | "formatLabel">,
  b: Pick<ClipperExportMapItem, "formatId" | "clipIndex" | "formatLabel">,
): number {
  return (
    Number(isFolderOnlyFormat(a.formatId)) - Number(isFolderOnlyFormat(b.formatId))
    || a.clipIndex - b.clipIndex
    || a.formatLabel.localeCompare(b.formatLabel)
  );
}

export function mapPublishPlatformLabel(platform: string, formatId: string): string {
  if (platform === "youtube" && getMapPublishTargets(formatId).includes("tiktok")) {
    return "YouTube Shorts";
  }
  return PLATFORM_LABELS[platform as SocialPublishablePlatform] ?? platform;
}

export function publishRecordForPlatform(
  item: Pick<ClipperExportMapItem, "publishes">,
  platform: string,
): ClipperExportPublishRecord | undefined {
  return item.publishes.find((row) => row.platform === platform);
}

export function isPlatformPublished(
  item: Pick<ClipperExportMapItem, "publishes">,
  platform: string,
): boolean {
  return publishRecordForPlatform(item, platform)?.status === "succeeded";
}

export function areMapTargetsPublished(
  item: Pick<ClipperExportMapItem, "formatId" | "publishes">,
): boolean {
  const targets = getMapPublishTargets(item.formatId);
  if (targets.length === 0) return false;
  return targets.every((platform) => isPlatformPublished(item, platform));
}

/** Succeeded publishes on platforms outside the in-app targets (e.g. older Instagram / X posts). */
export function succeededPublishesOutsideMapTargets(
  item: Pick<ClipperExportMapItem, "formatId" | "publishes">,
): ClipperExportPublishRecord[] {
  const targets = getMapPublishTargets(item.formatId);
  return item.publishes.filter(
    (row) =>
      row.status === "succeeded" &&
      !targets.includes(row.platform as SocialPublishablePlatform),
  );
}

export function mergePublishRecord(
  item: ClipperExportMapItem,
  record: ClipperExportPublishRecord,
): ClipperExportMapItem {
  return {
    ...item,
    publishes: [...item.publishes.filter((row) => row.platform !== record.platform), record],
  };
}

export function publishesVisualKey(item: Pick<ClipperExportMapItem, "publishes">): string {
  return item.publishes
    .map((row) => `${row.platform}:${row.status}:${row.watchUrl ?? ""}`)
    .sort()
    .join(",");
}
