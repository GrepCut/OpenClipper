import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { transcriptionService } from "../../../services/transcription.service";
import type { ParakeetModelStatus } from "../../../services/types/transcription.types";
import { isTauri } from "../../../shared/utils/platform.util";
import { clipperLog, clipperWarn } from "../shared/logger.util";

export type ModelStatusBadge = "not-installed" | "installed" | "downloading";

interface ModelDownloadEvent {
  path: string;
  received: number;
  total?: number | null;
  done: boolean;
  error?: string | null;
}

const EMPTY_MODEL_STATUS: ParakeetModelStatus = {
  installed: false,
  loaded: false,
  path: null,
  provider: null,
  source: null,
  manifestValid: null,
};

export function providerLabel(provider?: string | null): string | null {
  if (!provider) return null;
  if (provider === "directml") return "GPU (DirectML)";
  if (provider === "cpu") return "CPU";
  return provider;
}

export function accordionStatusText(
  modelStatus: ParakeetModelStatus | null,
  activeProvider: string | null,
): string {
  if (modelStatus?.installed) {
    return `Model installed — loads for each transcription and is released when it finishes${activeProvider ? ` — ${activeProvider}` : ""}`;
  }
  return "Model not installed (~671 MB)";
}

function statusBadge(
  modelStatus: ParakeetModelStatus | null,
  downloading: boolean,
): ModelStatusBadge {
  if (downloading) return "downloading";
  if (modelStatus?.installed) return "installed";
  return "not-installed";
}

function logParakeetDiagnostics(status: ParakeetModelStatus): void {
  clipperLog("settings/transcription: parakeet model check", {
    installed: status.installed,
    loaded: status.loaded,
    source: status.source ?? "unknown",
    path: status.path ?? null,
    provider: status.provider ?? null,
  });

  if (!status.installed) {
    clipperWarn("settings/transcription: parakeet model not found", {
      source: status.source ?? "missing",
      hint: "Dev: public/models/nemo-parakeet-tdt-0.6b-v3-int8 | Cache: %LOCALAPPDATA%/Open Clipper/models/",
    });
  }
}

export function useParakeetModelDownload() {
  const [modelStatus, setModelStatus] = useState<ParakeetModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadReceived, setDownloadReceived] = useState<number | null>(null);
  const [downloadTotal, setDownloadTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  /** True only while our Download button invoke is in flight (not per-file). */
  const sessionActiveRef = useRef(false);
  const progressRef = useRef<number | null>(null);
  const totalRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearProgress = useCallback(() => {
    progressRef.current = null;
    totalRef.current = null;
    setDownloadProgress(null);
    setDownloadReceived(null);
    setDownloadTotal(null);
  }, []);

  const refreshStatus = useCallback(async (): Promise<ParakeetModelStatus | null> => {
    if (!isTauri()) {
      if (isMountedRef.current) setModelStatus(EMPTY_MODEL_STATUS);
      return EMPTY_MODEL_STATUS;
    }
    try {
      const status = await transcriptionService.getParakeetModelStatus();
      if (isMountedRef.current) setModelStatus(status);
      return status;
    } catch (statusError) {
      if (isMountedRef.current) {
        setError(statusError instanceof Error ? statusError.message : String(statusError));
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (!modelStatus || !isTauri()) return;
    logParakeetDiagnostics(modelStatus);
  }, [modelStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isTauri()) {
        if (!cancelled && isMountedRef.current) setModelStatus(EMPTY_MODEL_STATUS);
        return;
      }
      try {
        const status = await transcriptionService.getParakeetModelStatus();
        if (!cancelled && isMountedRef.current) setModelStatus(status);
      } catch (statusError) {
        if (!cancelled && isMountedRef.current) {
          setError(statusError instanceof Error ? statusError.message : String(statusError));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<ModelDownloadEvent>("model-download", (event) => {
      if (cancelled || !isMountedRef.current) return;
      const payload = event.payload;
      if (!payload.path.includes("nemo-parakeet") && !payload.path.includes("parakeet")) {
        return;
      }
      if (payload.error) {
        setError(payload.error);
        sessionActiveRef.current = false;
        setDownloading(false);
        clearProgress();
        return;
      }

      const total = payload.total != null && payload.total > 0 ? payload.total : null;
      const prevTotal = totalRef.current;

      // Ignore tiny sidecar / extract events once a larger asset is the progress source.
      if (prevTotal != null && total != null && total < prevTotal * 0.9) {
        return;
      }
      // Extract emits done with 1/1 — keep bar stable until the invoke finishes.
      if (payload.done && (total == null || total <= 1024)) {
        return;
      }

      if (!sessionActiveRef.current) setDownloading(true);

      if (total == null) {
        if (!payload.done && progressRef.current == null) setDownloadProgress(null);
        return;
      }

      const ratio = Math.min(1, payload.received / total);
      const switchedDominant = prevTotal == null || total > prevTotal * 1.1;

      totalRef.current = total;
      setDownloadTotal(total);
      setDownloadReceived(payload.received);

      if (payload.done) {
        progressRef.current = 1;
        setDownloadProgress(1);
        if (!sessionActiveRef.current) {
          setDownloading(false);
          void refreshStatus();
        }
        return;
      }

      // New larger file: follow its real ratio (don't keep prior file's 100%).
      if (switchedDominant) {
        progressRef.current = ratio;
        setDownloadProgress(ratio);
        return;
      }

      // Same asset: ignore out-of-order dips only.
      const next = progressRef.current == null ? ratio : Math.max(progressRef.current, ratio);
      progressRef.current = next;
      setDownloadProgress(next);
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [clearProgress, refreshStatus]);

  const handleDownload = useCallback(async () => {
    setError(null);
    sessionActiveRef.current = true;
    setDownloading(true);
    progressRef.current = 0;
    totalRef.current = null;
    setDownloadProgress(0);
    setDownloadReceived(0);
    setDownloadTotal(null);
    try {
      await transcriptionService.downloadParakeetModel();
      if (!isMountedRef.current) return;
      progressRef.current = 1;
      setDownloadProgress(1);
      await refreshStatus();
    } catch (downloadError) {
      if (isMountedRef.current) {
        setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
      }
    } finally {
      sessionActiveRef.current = false;
      if (isMountedRef.current) {
        setDownloading(false);
        clearProgress();
      }
    }
  }, [clearProgress, refreshStatus]);

  const handleDelete = useCallback(async () => {
    setError(null);
    try {
      await transcriptionService.deleteParakeetModel();
      await refreshStatus();
    } catch (deleteError) {
      if (isMountedRef.current) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
        throw deleteError;
      }
    }
  }, [refreshStatus]);

  const showModelPanel = isTauri();
  const activeProvider = providerLabel(modelStatus?.provider);
  const showDownload = showModelPanel && !modelStatus?.installed && !downloading;
  const showDelete = showModelPanel && Boolean(modelStatus?.installed) && !downloading;

  return {
    modelStatus,
    downloading,
    downloadProgress,
    downloadReceived,
    downloadTotal,
    error,
    showModelPanel,
    activeProvider,
    showDownload,
    showDelete,
    badge: statusBadge(modelStatus, downloading),
    handleDownload,
    handleDelete,
  };
}
