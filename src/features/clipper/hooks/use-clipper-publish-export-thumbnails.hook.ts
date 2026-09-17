import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { captureVideoThumbnailCanvas } from "../lib/media/video-thumbnail-canvas.util";
import { clipperError } from "../shared/logger.util";
import {
  PROJECT_THUMB_MAX_DIMENSION,
  resolveExportMapItemMedia,
} from "../shared/clipper-publish-graph.util";

export function useClipperPublishExportThumbnails(items: ClipperExportMapItem[]) {
  const [thumbnails, setThumbnails] = useState<Record<string, HTMLCanvasElement>>({});
  const cacheRef = useRef<Record<string, HTMLCanvasElement>>({});
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemKey = useMemo(() => items.map((item) => item.id).join("|"), [items]);

  useEffect(() => {
    let cancelled = false;
    const current = itemsRef.current;
    const ids = current.map((item) => item.id);

    setThumbnails((prev) => {
      const next: Record<string, HTMLCanvasElement> = {};
      for (const id of ids) {
        const cached = cacheRef.current[id] ?? prev[id];
        if (cached) next[id] = cached;
      }
      return next;
    });

    void (async () => {
      for (const item of current) {
        if (cancelled) return;
        if (cacheRef.current[item.id]) continue;

        try {
          const media = await resolveExportMapItemMedia(item);
          if (cancelled) return;
          if (!media.previewUrl) continue;

          const canvas = await captureVideoThumbnailCanvas(
            media.previewUrl,
            PROJECT_THUMB_MAX_DIMENSION,
          );
          if (!canvas) continue;
          cacheRef.current[item.id] = canvas;
          if (cancelled) return;
          setThumbnails((prev) => ({ ...prev, [item.id]: canvas }));
        } catch (error) {
          clipperError("publish-export: thumbnail failed", error, { exportId: item.id });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemKey]);

  return { thumbnails };
}
