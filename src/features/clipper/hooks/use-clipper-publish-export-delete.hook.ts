import { useCallback, useEffect, useState } from "react";
import { appToast } from "../../../shared/utils/toast.service";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { removeClipperExport } from "../persistence/clipper-export-remove.util";

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

interface UseClipperPublishExportDeleteOptions {
  item: ClipperExportMapItem | null;
  canDelete: boolean;
  onDeleted: () => void;
}

export function useClipperPublishExportDelete({
  item,
  canDelete,
  onDeleted,
}: UseClipperPublishExportDeleteOptions) {
  const [deleteConfirmArmed, setDeleteConfirmArmed] = useState(false);

  useEffect(() => {
    setDeleteConfirmArmed(false);
  }, [item?.id]);

  const executeDelete = useCallback(async () => {
    if (!item || !canDelete) return;

    try {
      await removeClipperExport({
        projectId: item.projectId,
        exportId: item.id,
      });

      appToast.success("Export removed", "The export was removed from the publish map.");
      setDeleteConfirmArmed(false);
      onDeleted();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove export.";
      appToast.error("Delete failed", message);
      setDeleteConfirmArmed(false);
      throw error;
    }
  }, [canDelete, item, onDeleted]);

  useEffect(() => {
    if (!item || !canDelete) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;

      if (event.code === "Delete") {
        event.preventDefault();
        if (deleteConfirmArmed) {
          void executeDelete();
          return;
        }
        setDeleteConfirmArmed(true);
        return;
      }

      if (event.code === "Escape" && deleteConfirmArmed) {
        event.preventDefault();
        setDeleteConfirmArmed(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canDelete, deleteConfirmArmed, executeDelete, item]);

  const disarmDeleteConfirm = useCallback(() => {
    setDeleteConfirmArmed(false);
  }, []);

  return {
    deleteConfirmArmed,
    disarmDeleteConfirm,
    executeDelete,
  };
}
