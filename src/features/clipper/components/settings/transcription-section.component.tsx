import React, { useCallback, useEffect, useState } from "react";
import { Button, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { listen } from "@tauri-apps/api/event";
import { transcriptionService } from "../../../../services/transcription.service";
import type {
  ParakeetCapability,
  ParakeetModelStatus,
} from "../../../../services/types/transcription.types";
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

function providerLabel(provider?: string | null): string | null {
  if (!provider) return null;
  if (provider === "directml") return "GPU (DirectML)";
  if (provider === "cpu") return "CPU";
  return provider;
}

function logParakeetDiagnostics(
  status: ParakeetModelStatus,
  capability: ParakeetCapability | null,
): void {
  clipperLog("settings/transcription: parakeet model check", {
    installed: status.installed,
    loaded: status.loaded,
    source: status.source ?? "unknown",
    path: status.path ?? null,
    manifestValid: status.manifestValid ?? null,
    provider: status.provider ?? capability?.provider ?? null,
    probeAvailable: capability?.available ?? null,
    probeReason: capability?.reason ?? null,
  });

  if (status.installed && status.manifestValid === false) {
    clipperWarn("settings/transcription: model files present but manifest SHA mismatch", {
      path: status.path ?? null,
      source: status.source ?? null,
    });
  }

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
  const [capability, setCapability] = useState<ParakeetCapability | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) {
      setModelStatus({ installed: false, loaded: false, path: null, provider: null, source: null, manifestValid: null });
      setCapability(null);
      return;
    }
    try {
      const status = await transcriptionService.getParakeetModelStatus();
      setModelStatus(status);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    }
  }, []);

  const refreshCapability = useCallback(async () => {
    if (!isTauri()) {
      setCapability(null);
      return;
    }
    try {
      const probe = await transcriptionService.probeParakeet();
      setCapability(probe);
    } catch (probeError) {
      setCapability({
        available: false,
        modelInstalled: modelStatus?.installed ?? false,
        reason: probeError instanceof Error ? probeError.message : String(probeError),
      });
    }
  }, [modelStatus?.installed]);

  useEffect(() => {
    if (!modelStatus || !isTauri()) return;
    logParakeetDiagnostics(modelStatus, capability);
  }, [modelStatus, capability]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    void refreshCapability();
  }, [refreshCapability, modelStatus?.installed]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<ModelDownloadEvent>("model-download", (event) => {
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
        void refreshCapability();
        return;
      }
      setDownloading(true);
      if (payload.total && payload.total > 0) {
        setDownloadProgress(payload.received / payload.total);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      unlisten?.();
    };
  }, [refreshCapability, refreshStatus]);

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    setDownloadProgress(0);
    try {
      await transcriptionService.downloadParakeetModel();
      await transcriptionService.loadParakeetModel();
      await refreshStatus();
      await refreshCapability();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await transcriptionService.deleteParakeetModel();
      await refreshStatus();
      setCapability(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const showModelPanel = isTauri();
  const activeProvider =
    providerLabel(modelStatus?.provider) ??
    providerLabel(capability?.provider) ??
    (capability?.available === false ? "CPU fallback" : null);

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

            {capability && !capability.available && capability.reason && (
              <Text fontSize="xs" color={theme.text.muted}>
                {capability.reason}
              </Text>
            )}

            {downloading && (
              <Progress.Root value={downloadProgress != null ? downloadProgress * 100 : null} size="sm">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            )}

            <HStack gap={2}>
              {!modelStatus?.installed && (
                <Button size="sm" onClick={() => void handleDownload()} loading={downloading}>
                  Download model
                </Button>
              )}
              {modelStatus?.installed && !downloading && (
                <Button size="sm" variant="outline" onClick={() => void handleDelete()}>
                  Delete model
                </Button>
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
