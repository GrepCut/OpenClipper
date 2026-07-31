import { useCallback, useEffect, useMemo, useState } from "react";
import { appToast } from "../../../shared/utils/toast.service";
import { isTauri } from "../../../shared/utils/platform.util";
import {
  fetchClipperExport,
  patchClipperExportSocial,
  type ClipperExportSocialPatch,
} from "../persistence/clipper-export-db-api.util";
import { socialFieldsFromExportRecord } from "../hooks/clipper-pipeline/export-manifest-resolve.util";
import {
  socialFieldsFromResult,
  type ExportSocialFields,
} from "../persistence/clipper-export-social.util";
import { CLIPPER_EXPORT_EXTERNAL_SYNC_MS } from "../persistence/clipper-export-map-sync.util";
import type { ClipperFormatResult } from "../shared/state.util";

export function useClipperExportMetadata({
  result,
  onMetadataSaved,
  watchExternal = false,
}: {
  result: ClipperFormatResult;
  onMetadataSaved: (exportId: string, fields: ExportSocialFields) => void;
  watchExternal?: boolean;
}) {
  const canEdit = isTauri();
  const [fields, setFields] = useState<ExportSocialFields>(() => socialFieldsFromResult(result));
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setFields(socialFieldsFromResult(result));
  }, [result.id, result.socialTitle, result.socialDescription, result.socialHashtags]);

  const dirty = useMemo(() => {
    const current = socialFieldsFromResult(result);
    return (
      fields.socialTitle !== current.socialTitle ||
      fields.socialDescription !== current.socialDescription ||
      fields.socialHashtags !== current.socialHashtags
    );
  }, [fields, result]);

  const updateField = useCallback((key: keyof ExportSocialFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    if (!canEdit) return;
    setIsSaving(true);
    try {
      const patch: ClipperExportSocialPatch = { ...fields };
      const record = await patchClipperExportSocial(result.id, patch, "overwrite");
      const saved = socialFieldsFromExportRecord(record);
      onMetadataSaved(result.id, saved);
      setFields(saved);
      appToast.success("Export metadata saved");
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Failed to save metadata");
    } finally {
      setIsSaving(false);
    }
  }, [canEdit, fields, onMetadataSaved, result.id]);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!canEdit) return;
      const silent = options?.silent === true;
      if (!silent) setIsRefreshing(true);
      try {
        const record = await fetchClipperExport(result.id);
        const saved = socialFieldsFromExportRecord(record);
        const current = socialFieldsFromResult(result);
        const changed =
          saved.socialTitle !== current.socialTitle ||
          saved.socialDescription !== current.socialDescription ||
          saved.socialHashtags !== current.socialHashtags;

        if (changed) {
          onMetadataSaved(result.id, saved);
          if (!dirty) {
            setFields(saved);
          }
          if (!silent) {
            appToast.success("Metadata refreshed");
          }
        } else if (!silent) {
          appToast.success("Metadata refreshed");
        }
      } catch (error) {
        if (!silent) {
          appToast.error(error instanceof Error ? error.message : "Failed to refresh metadata");
        }
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [canEdit, dirty, onMetadataSaved, result],
  );

  useEffect(() => {
    if (!watchExternal || !canEdit || dirty || isSaving) return;
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, CLIPPER_EXPORT_EXTERNAL_SYNC_MS);
    return () => window.clearInterval(interval);
  }, [canEdit, dirty, isSaving, refresh, watchExternal]);

  return {
    canEdit,
    fields,
    updateField,
    save,
    refresh,
    dirty,
    isSaving,
    isRefreshing,
  };
}
