import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchClipperExportsAll,
  purgeClipperExportsMissing,
  type ClipperExportMapItem,
} from "../persistence/clipper-export-db-api.util";
import { onClipperExportsChanged } from "../persistence/clipper-export-events.util";
import { onClipperOwnersChanged } from "../persistence/clipper-owner-events.util";
import { clipperError } from "../shared/logger.util";
import {
  buildPublishGraphData,
  resolveExportMapItemMedia,
  type PublishGraphData,
  type PublishSelection,
} from "../shared/clipper-publish-graph.util";
import type { ClipperFormatResult } from "../shared/state.util";

export function useClipperPublishMap() {
  const [items, setItems] = useState<ClipperExportMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<PublishSelection>({ kind: "none" });
  const [selectedResult, setSelectedResult] = useState<ClipperFormatResult | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);

  const graphData: PublishGraphData = useMemo(
    () => buildPublishGraphData(items),
    [items],
  );

  const selectedExportId = selection.kind === "export" ? selection.exportId : null;
  const selectedProjectId = selection.kind === "project" ? selection.projectId : null;
  const selectedOwnerId = selection.kind === "owner" ? selection.ownerId : null;

  const selectedItem = useMemo(
    () => (selectedExportId ? items.find((item) => item.id === selectedExportId) ?? null : null),
    [items, selectedExportId],
  );

  const selectedProjectItems = useMemo(
    () => (selectedProjectId ? items.filter((item) => item.projectId === selectedProjectId) : []),
    [items, selectedProjectId],
  );

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    const first = selectedProjectItems[0];
    if (!first) return null;
    return {
      projectId: selectedProjectId,
      projectName: first.projectName,
      clipperOwnerId: first.clipperOwnerId ?? null,
      clipperOwnerName: first.clipperOwnerName ?? null,
      exports: selectedProjectItems,
    };
  }, [selectedProjectId, selectedProjectItems]);

  const loadExports = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      await purgeClipperExportsMissing().catch((error) => {
        clipperError("publish-map: purge missing exports failed", error);
      });
      const next = await fetchClipperExportsAll();
      setItems(next);
    } catch (error) {
      clipperError("publish-map: refresh failed", error);
      setItems([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => loadExports(true), [loadExports]);

  useEffect(() => {
    void loadExports(true);
    const unsubscribeExports = onClipperExportsChanged(() => {
      void loadExports(false);
    });
    const unsubscribeOwners = onClipperOwnersChanged(() => {
      void loadExports(false);
    });
    const onFocus = () => {
      void loadExports(false);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribeExports();
      unsubscribeOwners();
      window.removeEventListener("focus", onFocus);
    };
  }, [loadExports]);

  useEffect(() => {
    if (!selectedItem) {
      setSelectedResult(null);
      return;
    }

    let cancelled = false;
    setMediaLoading(true);
    void resolveExportMapItemMedia(selectedItem)
      .then((result) => {
        if (!cancelled) setSelectedResult(result);
      })
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedItem]);

  const selectNode = useCallback((nodeId: string | null, nodeType?: string) => {
    if (!nodeId) {
      setSelection({ kind: "none" });
      return;
    }
    if (nodeType === "owner" || nodeId.startsWith("owner:")) {
      setSelection({ kind: "owner", ownerId: nodeId.replace(/^owner:/, "") });
      return;
    }
    if (nodeType === "project" || nodeId.startsWith("project:")) {
      setSelection({ kind: "project", projectId: nodeId.replace(/^project:/, "") });
      return;
    }
    setSelection({ kind: "export", exportId: nodeId });
  }, []);

  const selectExport = useCallback((exportId: string) => {
    setSelection({ kind: "export", exportId });
  }, []);

  const updateItemPublishStatus = useCallback(
    (exportId: string, publishStatus: ClipperExportMapItem["publishStatus"]) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === exportId
            ? {
                ...item,
                publishStatus,
                isPublished: publishStatus?.status === "succeeded",
              }
            : item,
        ),
      );
    },
    [],
  );

  return {
    items,
    graphData,
    loading,
    mediaLoading,
    selection,
    selectedExportId,
    selectedProjectId,
    selectedOwnerId,
    selectedItem,
    selectedProject,
    selectedResult,
    selectNode,
    selectExport,
    refresh,
    updateItemPublishStatus,
  };
}
