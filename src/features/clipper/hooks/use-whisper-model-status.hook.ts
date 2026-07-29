import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { transcriptionService } from "../../../services/transcription.service";
import type { WhisperModelStatus } from "../../../services/types/transcription.types";
import { isTauri } from "../../../shared/utils/platform.util";
import { providerLabel, type ModelStatusBadge } from "./use-parakeet-model-download.hook";

interface ModelDownloadEvent {
  path: string;
  received: number;
  total?: number | null;
  done: boolean;
  error?: string | null;
}

const WHISPER_MODEL_PATH = "whisper-large-v3-turbo-dml";

function statusBadge(installed: boolean, downloading: boolean): ModelStatusBadge {
  if (downloading) return "downloading";
  return installed ? "installed" : "not-installed";
}

export function useWhisperModelStatus() {
  const [modelStatus, setModelStatus] = useState<WhisperModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadReceived, setDownloadReceived] = useState<number | null>(null);
  const [downloadTotal, setDownloadTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
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

  const refreshStatus = useCallback(async (): Promise<WhisperModelStatus | null> => {
    if (!isTauri()) return null;
    try {
      const status = await transcriptionService.getWhisperModelStatus();
      if (isMountedRef.current) setModelStatus(status);
      return status;
    } catch (reason) {
      if (isMountedRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<ModelDownloadEvent>("model-download", (event) => {
      if (cancelled || !isMountedRef.current) return;
      const payload = event.payload;
      if (!payload.path.includes(WHISPER_MODEL_PATH)) return;

      if (payload.error) {
        setError(payload.error);
        sessionActiveRef.current = false;
        setDownloading(false);
        clearProgress();
        return;
      }

      const total = payload.total != null && payload.total > 0 ? payload.total : null;
      const previousTotal = totalRef.current;
      if (previousTotal != null && total != null && total < previousTotal * 0.9) return;

      if (!sessionActiveRef.current) setDownloading(true);
      if (total == null) {
        if (!payload.done && progressRef.current == null) setDownloadProgress(null);
        return;
      }

      const ratio = Math.min(1, payload.received / total);
      const switchedDominant = previousTotal == null || total > previousTotal * 1.1;
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

      if (switchedDominant) {
        progressRef.current = ratio;
        setDownloadProgress(ratio);
        return;
      }

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
      await transcriptionService.downloadWhisperModel();
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
      await transcriptionService.deleteWhisperModel();
      await refreshStatus();
    } catch (deleteError) {
      if (isMountedRef.current) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
      throw deleteError;
    }
  }, [refreshStatus]);

  const installed = Boolean(modelStatus?.installed);
  const showModelPanel = isTauri();
  return {
    modelStatus,
    badge: statusBadge(installed, downloading),
    activeProvider: providerLabel(modelStatus?.provider),
    downloading,
    downloadProgress,
    downloadReceived,
    downloadTotal,
    error,
    handleDownload,
    handleDelete,
    installed,
    showDownload: showModelPanel && !installed && !downloading,
    showDelete: showModelPanel && installed && !downloading,
  };
}
