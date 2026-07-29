import React from "react";
import { HStack, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { Download, Trash2 } from "lucide-react";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { ModernSwitch } from "../../../../shared/components/ui/modern-switch.component";
import { formatBytes } from "../../shared/logger.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import {
  accordionStatusText,
  useParakeetModelDownload,
} from "../../hooks/use-parakeet-model-download.hook";
import { ClipperProgressBar } from "../clipper-progress-bar.component";
import { SettingRow, SettingSection } from "./setting-controls.component";
import { DeleteParakeetModelModal } from "./delete-parakeet-model-modal.component";
import { TranscriptionModelRow } from "./transcription-model-row.component";
import { useWhisperModelStatus } from "../../hooks/use-whisper-model-status.hook";
import { useVocalsIsolateModelStatus } from "../../hooks/use-vocals-isolate-model-status.hook";
import { loadClipperSettings, saveClipperSettings } from "../../settings/settings-storage.util";
import type {
  ClipperIsolateVocals,
  ClipperTranscriptionEngine,
} from "../../settings/settings.util";

function downloadCaption(received: number | null, total: number | null): string | undefined {
  if (received == null) return undefined;
  if (total != null && total > 0) return `${formatBytes(received)} / ${formatBytes(total)}`;
  return formatBytes(received);
}

interface TranscriptionSectionProps {
  defaultOpen?: boolean;
  variant?: "accordion" | "flat";
}

export const TranscriptionSection: React.FC<TranscriptionSectionProps> = ({
  defaultOpen = false,
  variant = "accordion",
}) => {
  const { theme } = useClipperUi();
  const model = useParakeetModelDownload();
  const whisper = useWhisperModelStatus();
  const demucs = useVocalsIsolateModelStatus();
  const [activeEngine, setActiveEngine] = React.useState<ClipperTranscriptionEngine>(
    () => loadClipperSettings().transcription.engine,
  );
  const [isolateVocals, setIsolateVocals] = React.useState<ClipperIsolateVocals>(
    () => loadClipperSettings().transcription.isolateVocals,
  );

  const selectEngine = (engine: ClipperTranscriptionEngine) => {
    const next = {
      ...loadClipperSettings(),
      transcription: { ...loadClipperSettings().transcription, engine },
    };
    saveClipperSettings(next);
    setActiveEngine(engine);
  };

  const setIsolateVocalsSetting = (enabled: boolean) => {
    const value: ClipperIsolateVocals = enabled ? "on" : "off";
    const next = {
      ...loadClipperSettings(),
      transcription: { ...loadClipperSettings().transcription, isolateVocals: value },
    };
    saveClipperSettings(next);
    setIsolateVocals(value);
  };

  const {
    open: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();

  const deleteModal = (
    <DeleteParakeetModelModal
      isOpen={isDeleteOpen}
      onClose={onDeleteClose}
      onConfirm={model.handleDelete}
    />
  );

  const vocalsControls = (
    <VStack align="stretch" gap={3}>
      <SettingRow
        label="Isolate vocals (better for songs)"
        hint="Runs Demucs before speech-to-text. Uses CPU by default; download the ~316 MB model first."
        control={
          <ModernSwitch
            checked={isolateVocals === "on"}
            onCheckedChange={setIsolateVocalsSetting}
          />
        }
      />
      <TranscriptionModelRow
        name="Demucs vocals (HT-Demucs FT)"
        description="Optional music/vocal separator used when Isolate vocals is on. Runs on CPU by default (DirectML optional via OPEN_CLIPPER_DEMUCS_DML=1)."
        size="~316 MB"
        badge={demucs.badge}
        provider={demucs.activeProvider}
        showDownload={demucs.showDownload}
        showDelete={demucs.showDelete}
        downloading={demucs.downloading}
        downloadProgress={demucs.downloadProgress}
        downloadReceived={demucs.downloadReceived}
        downloadTotal={demucs.downloadTotal}
        error={
          demucs.error ??
          (!demucs.installed && !demucs.downloading && isolateVocals === "on"
            ? "Download Demucs before enabling Isolate vocals."
            : null)
        }
        onDownload={() => void demucs.handleDownload()}
        onDeleteOpen={() => void demucs.handleDelete()}
      />
    </VStack>
  );

  if (variant === "flat") {
    return (
      <>
        {vocalsControls}
        <TranscriptionModelRow
          selected={activeEngine === "parakeet"}
          onSelect={model.modelStatus?.installed ? () => selectEngine("parakeet") : undefined}
          badge={model.badge}
          provider={model.activeProvider}
          showDownload={model.showDownload}
          showDelete={model.showDelete}
          downloading={model.downloading}
          downloadProgress={model.downloadProgress}
          downloadReceived={model.downloadReceived}
          downloadTotal={model.downloadTotal}
          error={model.error}
          onDownload={() => void model.handleDownload()}
          onDeleteOpen={onDeleteOpen}
        />
        <TranscriptionModelRow
          name="Whisper Large v3 Turbo"
          description="Higher-quality local speech-to-text via sherpa-onnx with DirectML. Loads only while transcribing."
          size="~1.75 GB"
          selected={activeEngine === "whisper"}
          onSelect={whisper.installed ? () => selectEngine("whisper") : undefined}
          badge={whisper.badge}
          provider={whisper.activeProvider}
          showDownload={whisper.showDownload}
          showDelete={whisper.showDelete}
          downloading={whisper.downloading}
          downloadProgress={whisper.downloadProgress}
          downloadReceived={whisper.downloadReceived}
          downloadTotal={whisper.downloadTotal}
          error={
            whisper.error ??
            (!whisper.installed && !whisper.downloading
              ? "Whisper is not installed on this device yet."
              : null)
          }
          onDownload={() => void whisper.handleDownload()}
          onDeleteOpen={() => void whisper.handleDelete()}
        />
        {deleteModal}
      </>
    );
  }

  return (
    <>
      <SettingSection
        title="Transcription"
        description="Local speech-to-text for clip captions"
        defaultOpen={defaultOpen}
      >
        <VStack align="stretch" gap={3}>
          {vocalsControls}
          {model.showModelPanel && (
            <Text fontSize="xs" color={theme.text.muted}>
              {accordionStatusText(model.modelStatus, model.activeProvider)}
            </Text>
          )}
          {model.downloading && (
            <ClipperProgressBar
              label="Downloading model"
              value={model.downloadProgress}
              caption={downloadCaption(model.downloadReceived, model.downloadTotal)}
            />
          )}
          {(model.showDownload || model.showDelete) && (
            <HStack gap={2} flexShrink={0} flexWrap="wrap">
              {model.showDownload && (
                <OutlinedActionButton
                  startIcon={<Download size={16} />}
                  onClick={() => void model.handleDownload()}
                  loading={model.downloading}
                  whiteSpace="nowrap"
                >
                  Download model
                </OutlinedActionButton>
              )}
              {model.showDelete && (
                <OutlinedActionButton
                  tone="danger"
                  startIcon={<Trash2 size={16} />}
                  onClick={onDeleteOpen}
                  whiteSpace="nowrap"
                >
                  Delete model
                </OutlinedActionButton>
              )}
            </HStack>
          )}
          {model.error && (
            <Text fontSize="xs" color="red.300">
              {model.error}
            </Text>
          )}
        </VStack>
      </SettingSection>
      {deleteModal}
    </>
  );
};
