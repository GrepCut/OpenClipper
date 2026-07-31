import { useCallback, useEffect, useState } from "react";

import { normalizeAutoPartsSegmentLengthSec, type AutoPartsSegmentLengthSec } from "../../engine/segmentation";
import {
  flushClipperProjectMetadataSave,
  registerClipperPersistenceFlushListeners,
  scheduleClipperProjectMetadataSave,
  scheduleClipperProjectMetadataSaveImmediate,
} from "../../persistence/metadata-autosave.util";
import {
  flushClipperProjectSettingsSave,
  scheduleClipperProjectSettingsSave,
} from "../../persistence/settings-autosave.util";
import {
  fetchClipperExportRecords,
} from "./export-manifest-resolve.util";
import { loadClipperExportsFromDb } from "../../persistence/clipper-export-db-load.util";
import type { ClipperProjectMetadata } from "../../persistence/project-metadata.util";
import { releasePlayableMediaUrl } from "../../persistence/tauri-media.util";
import { deriveInitialPipelineState } from "../../pipeline/resume.util";
import { DEFAULT_CLIPPER_SETTINGS, type ClipperSettings } from "../../settings/settings.util";
import { saveClipperSettings } from "../../settings/settings-storage.util";
import type { ClipperFormatResult } from "../../shared/state.util";
import type { ExportSocialFields } from "../../persistence/clipper-export-social.util";
import type { ClipperStage } from "../../shared/stages.util";
import type { ClipperLoadedProject } from "../use-clipper-project-loader.hook";
import type { Project } from "../../../../services/projects.service";
import { deriveAutoPartsSegmentLengthSec, deriveRangeLocked, usePipelineRefs } from "./clipper-pipeline-context";
import { patchPipelineState } from "./clipper-pipeline-state.util";
import {
  INITIAL_PIPELINE_STATE,
  METADATA_IMMEDIATE_FLUSH_STAGES,
  type ClipperPipelineRefs,
} from "./clipper-pipeline.types";

export interface UseClipperPipelineCoreResult {
  projectId: string;
  state: import("../../shared/state.util").ClipperPipelineState;
  setState: React.Dispatch<React.SetStateAction<import("../../shared/state.util").ClipperPipelineState>>;
  settings: ClipperSettings;
  setSettingsState: React.Dispatch<React.SetStateAction<ClipperSettings>>;
  refs: ClipperPipelineRefs;
  persistedExportCount: number;
  setPersistedExportCount: React.Dispatch<React.SetStateAction<number>>;
  rangeLocked: boolean;
  setRangeLocked: React.Dispatch<React.SetStateAction<boolean>>;
  disabledCollageRegionIds: string[];
  setDisabledCollageRegionIds: React.Dispatch<React.SetStateAction<string[]>>;
  autoPartsSegmentLengthSec: AutoPartsSegmentLengthSec;
  setAutoPartsSegmentLengthSec: React.Dispatch<React.SetStateAction<AutoPartsSegmentLengthSec>>;
  persistMetadata: (patch: Partial<ClipperProjectMetadata>, stage?: ClipperStage) => void;
  revokePreviewUrls: () => void;
  clearSession: () => void;
  updateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
  resetSettings: () => void;
  reset: () => void;
  setActiveClipIndex: (index: number) => void;
  hydrateExportsFromDisk: () => Promise<ClipperFormatResult[]>;
  updateExportMetadata: (exportId: string, fields: ExportSocialFields) => void;
}

export function useClipperPipelineCore(
  project: Project,
  loaded: ClipperLoadedProject | null,
): UseClipperPipelineCoreResult {
  const [state, setState] = useState(() => deriveInitialPipelineState(loaded, project.id));
  const [settings, setSettingsState] = useState<ClipperSettings>(
    () => loaded?.settings ?? DEFAULT_CLIPPER_SETTINGS,
  );
  const [persistedExportCount, setPersistedExportCount] = useState(0);
  const [rangeLocked, setRangeLocked] = useState(() => deriveRangeLocked(loaded));
  const [disabledCollageRegionIds, setDisabledCollageRegionIds] = useState<string[]>([]);
  const [autoPartsSegmentLengthSec, setAutoPartsSegmentLengthSec] = useState<AutoPartsSegmentLengthSec>(
    () => deriveAutoPartsSegmentLengthSec(loaded),
  );

  const refs = usePipelineRefs(setState, loaded);
  const {
    abortRef,
    previewUrlsRef,
    sessionRef,
    activeClipIndexRef,
    metadataRef,
    resumeStartedRef,
  } = refs;

  const hydrateExportsFromDisk = useCallback(async (): Promise<ClipperFormatResult[]> => {
    const restored = await loadClipperExportsFromDb(project.id);
    if (!restored.length) return [];

    for (const r of restored) {
      if (r.previewUrl.startsWith("blob:")) {
        previewUrlsRef.current.push(r.previewUrl);
      }
    }

    const metadataStage = metadataRef.current.stage;
    patchPipelineState(setState, (draft) => {
      draft.exportHistory = restored;
      if (metadataStage === "rendering") {
        draft.stage = "preview";
      } else if (metadataStage === "done") {
        draft.stage = "done";
      }
    });

    setPersistedExportCount(restored.length);
    return restored;
  }, [metadataRef, previewUrlsRef, project.id]);

  const persistMetadata = useCallback(
    (patch: Partial<ClipperProjectMetadata>, stage?: ClipperStage) => {
      metadataRef.current = {
        ...metadataRef.current,
        ...patch,
        stage: stage ?? patch.stage ?? metadataRef.current.stage,
      };
      const nextStage = metadataRef.current.stage;
      if (METADATA_IMMEDIATE_FLUSH_STAGES.includes(nextStage)) {
        scheduleClipperProjectMetadataSaveImmediate(project.id, metadataRef.current);
      } else {
        scheduleClipperProjectMetadataSave(project.id, metadataRef.current);
      }
    },
    [metadataRef, project.id],
  );

  const revokePreviewUrls = useCallback(() => {
    for (const url of previewUrlsRef.current) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    previewUrlsRef.current = [];
  }, [previewUrlsRef]);

  const clearSession = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      releasePlayableMediaUrl(session.sourceUrl);
      if (session.rangeTrimmedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(session.rangeTrimmedVideoUrl);
      } else if (session.trimmedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(session.trimmedVideoUrl);
      }
      sessionRef.current = null;
    }
  }, [sessionRef]);

  const updateSettings = useCallback(
    (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => {
      setSettingsState((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (p: ClipperSettings) => ClipperSettings)(prev)
            : updater;
        scheduleClipperProjectSettingsSave(project.id, next);
        saveClipperSettings(next);
        return next;
      });
    },
    [project.id],
  );

  const resetSettings = useCallback(() => updateSettings(DEFAULT_CLIPPER_SETTINGS), [updateSettings]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    revokePreviewUrls();
    clearSession();
    resumeStartedRef.current = false;
    activeClipIndexRef.current = 0;
    setState(INITIAL_PIPELINE_STATE);
    persistMetadata(
      {
        stage: "idle",
        sourceMediaFileId: null,
        clipStart: 0,
        clipEnd: null,
        transcribedClipStart: undefined,
        transcribedClipEnd: undefined,
        activeClipIndex: undefined,
      },
      "idle",
    );
  }, [
    abortRef,
    activeClipIndexRef,
    clearSession,
    persistMetadata,
    resumeStartedRef,
    revokePreviewUrls,
  ]);

  const setActiveClipIndex = useCallback(
    (index: number) => {
      activeClipIndexRef.current = index;
      const session = sessionRef.current;
      if (session) session.activeClipIndex = index;
      setState((prev) => ({ ...prev, activeClipIndex: index }));
      persistMetadata({ activeClipIndex: index });
    },
    [activeClipIndexRef, persistMetadata, sessionRef],
  );

  const updateExportMetadata = useCallback(
    (exportId: string, fields: ExportSocialFields) => {
      patchPipelineState(setState, (draft) => {
        draft.exportHistory = draft.exportHistory.map((entry) =>
          entry.id === exportId ? { ...entry, ...fields } : entry,
        );
        draft.clipPreviews = draft.clipPreviews.map((preview) => ({
          ...preview,
          results: preview.results.map((entry) =>
            entry.id === exportId ? { ...entry, ...fields } : entry,
          ),
        }));
      });
    },
    [setState],
  );

  useEffect(() => {
    if (!loaded) return;
    void hydrateExportsFromDisk();
  }, [hydrateExportsFromDisk, loaded]);

  useEffect(() => {
    if (!loaded) return;
    void fetchClipperExportRecords(project.id)
      .then((exports) => setPersistedExportCount(exports.length))
      .catch(() => setPersistedExportCount(0));
  }, [loaded, project.id]);

  useEffect(() => {
    registerClipperPersistenceFlushListeners();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokePreviewUrls();
      clearSession();
      void flushClipperProjectMetadataSave();
      void flushClipperProjectSettingsSave();
    };
  }, [abortRef, clearSession, revokePreviewUrls]);

  return {
    projectId: project.id,
    state,
    setState,
    settings,
    setSettingsState,
    refs,
    persistedExportCount,
    setPersistedExportCount,
    rangeLocked,
    setRangeLocked,
    disabledCollageRegionIds,
    setDisabledCollageRegionIds,
    autoPartsSegmentLengthSec,
    setAutoPartsSegmentLengthSec,
    persistMetadata,
    revokePreviewUrls,
    clearSession,
    updateSettings,
    resetSettings,
    reset,
    setActiveClipIndex,
    hydrateExportsFromDisk,
    updateExportMetadata,
  };
}
