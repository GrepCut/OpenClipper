import { useEffect, useState } from "react";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import {
  captureVideoThumbnailCanvas,
} from "../lib/media/video-thumbnail-canvas.util";
import { clipperError } from "../shared/logger.util";
import {
  pickProjectCoverExports,
  PROJECT_THUMB_MAX_DIMENSION,
  resolveExportMapItemMedia,
} from "../shared/clipper-publish-graph.util";

export function useClipperPublishGraphThumbnails(items: ClipperExportMapItem[]) {
  const [thumbnails, setThumbnails] = useState<Record<string, HTMLCanvasElement>>({});

  useEffect(() => {
    let cancelled = false;
    const covers = pickProjectCoverExports(items);
    const projectIds = Object.keys(covers);

    setThumbnails((prev) => {
      const next: Record<string, HTMLCanvasElement> = {};
      for (const projectId of projectIds) {
        if (prev[projectId]) next[projectId] = prev[projectId];
      }
      return next;
    });

    void (async () => {
      for (const [projectId, exportItem] of Object.entries(covers)) {
        if (cancelled) return;
        try {
          const media = await resolveExportMapItemMedia(exportItem);
          if (!media.previewUrl || cancelled) continue;
          const canvas = await captureVideoThumbnailCanvas(
            media.previewUrl,
            PROJECT_THUMB_MAX_DIMENSION,
          );
          if (!canvas || cancelled) continue;
          setThumbnails((prev) => ({ ...prev, [projectId]: canvas }));
        } catch (error) {
          clipperError("publish-graph: project thumbnail failed", error, { projectId });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

  return { thumbnails };
}
