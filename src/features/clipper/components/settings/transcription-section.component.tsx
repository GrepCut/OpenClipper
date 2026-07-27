import React from "react";
import { HStack, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { Download, Trash2 } from "lucide-react";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { formatBytes } from "../../shared/logger.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import {
  accordionStatusText,
  useParakeetModelDownload,
} from "../../hooks/use-parakeet-model-download.hook";
import { ClipperProgressBar } from "../clipper-progress-bar.component";
import { SettingSection } from "./setting-controls.component";
import { DeleteParakeetModelModal } from "./delete-parakeet-model-modal.component";
import { TranscriptionModelRow } from "./transcription-model-row.component";

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

  if (variant === "flat") {
    return (
      <>
        <TranscriptionModelRow
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
        {deleteModal}
      </>
    );
  }

  return (
    <>
      <SettingSection
        title="Transcription"
        description="Parakeet Local speech-to-text for clip captions"
        defaultOpen={defaultOpen}
      >
        <VStack align="stretch" gap={3}>
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
