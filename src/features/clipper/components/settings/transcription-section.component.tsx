import React, { useCallback, useEffect, useRef, useState } from "react";
import { HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { Download, Trash2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { transcriptionService } from "../../../../services/transcription.service";
import type { ParakeetModelStatus } from "../../../../services/types/transcription.types";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { isTauri } from "../../../../shared/utils/platform.util";
import { clipperLog, clipperWarn } from "../../shared/logger.util";
import { SettingSection } from "./setting-controls.component";

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

function providerLabel(provider?: string | null): string | null {
  if (!provider) return null;
  if (provider === "directml") return "GPU (DirectML)";
  if (provider === "cpu") return "CPU";
  return provider;
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

export const TranscriptionSection: React.FC = () => {
  const { theme } = useClipperUi();
  const [modelStatus, setModelStatus] = useState<ParakeetModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async (): Promise<ParakeetModelStatus | null> => {
    if (!isTauri()) {
      if (isMountedRef.current) {
        setModelStatus(EMPTY_MODEL_STATUS);
      }
      return EMPTY_MODEL_STATUS;
    }
    try {
      const status = await transcriptionService.getParakeetModelStatus();
      if (isMountedRef.current) {
        setModelStatus(status);
      }
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
        if (!cancelled && isMountedRef.current) {
          setModelStatus(EMPTY_MODEL_STATUS);
        }
        return;
      }
      try {
        const status = await transcriptionService.getParakeetModelStatus();
        if (!cancelled && isMountedRef.current) {
          setModelStatus(status);
        }
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
        setDownloading(false);
        setDownloadProgress(null);
        return;
      }
      if (payload.done) {
        setDownloading(false);
        setDownloadProgress(1);
        void refreshStatus();
        return;
      }
      setDownloading(true);
      if (payload.total && payload.total > 0) {
        setDownloadProgress(payload.received / payload.total);
      }
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
  }, [refreshStatus]);

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    setDownloadProgress(0);
    try {
      await transcriptionService.downloadParakeetModel();
      await refreshStatus();
    } catch (downloadError) {
      if (isMountedRef.current) {
        setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
        setDownloading(false);
        setDownloadProgress(null);
      }
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await transcriptionService.deleteParakeetModel();
      await refreshStatus();
    } catch (deleteError) {
      if (isMountedRef.current) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
    }
  };

  const showModelPanel = isTauri();
  const activeProvider = providerLabel(modelStatus?.provider);

  return (
    <SettingSection
      title="Transcription"
      description="Parakeet Local speech-to-text for clip captions"
    >
      <VStack align="stretch" gap={3}>
        {showModelPanel && (
          <VStack align="stretch" gap={2}>
            <Text fontSize="xs" color={theme.text.muted}>
              {modelStatus?.loaded
                ? `Model loaded and ready${activeProvider ? ` — ${activeProvider}` : ""}`
                : modelStatus?.installed
                  ? `Model installed — loads on first transcription${activeProvider ? ` — ${activeProvider}` : ""}`
                  : "Model not installed (~671 MB)"}
            </Text>

            {downloading && (
              <Progress.Root value={downloadProgress != null ? downloadProgress * 100 : null} size="sm">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            )}

            <HStack gap={2}>
              {!modelStatus?.installed && (
                <OutlinedActionButton
                  startIcon={<Download size={16} />}
                  onClick={() => void handleDownload()}
                  loading={downloading}
                >
                  Download model
                </OutlinedActionButton>
              )}
              {modelStatus?.installed && !downloading && (
                <OutlinedActionButton
                  tone="danger"
                  startIcon={<Trash2 size={16} />}
                  onClick={() => void handleDelete()}
                >
                  Delete model
                </OutlinedActionButton>
              )}
            </HStack>
          </VStack>
        )}

        {error && (
          <Text fontSize="xs" color="red.300">
            {error}
          </Text>
        )}
      </VStack>
    </SettingSection>
  );
};
