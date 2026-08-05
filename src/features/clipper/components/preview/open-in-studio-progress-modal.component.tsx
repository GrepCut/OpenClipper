import React from "react";
import { Text, VStack } from "@chakra-ui/react";
import { StyledModal } from "../../../../shared/components/styled-modal.component";
import type {
  OpenInStudioPhase,
  OpenInStudioProgress,
} from "../../lib/studio-import/build-studio-import.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { ClipperProgressBar } from "../clipper-progress-bar.component";

const PHASE_LABELS: Record<OpenInStudioPhase, string> = {
  preparing: "Preparing clip…",
  thumbnails: "Generating thumbnails…",
  staging: "Staging import…",
  opening: "Opening Studio…",
};

interface OpenInStudioProgressModalProps {
  isOpen: boolean;
  progress: OpenInStudioProgress | null;
}

export function OpenInStudioProgressModal({
  isOpen,
  progress,
}: OpenInStudioProgressModalProps) {
  const { theme } = useClipperUi();
  const phase = progress?.phase ?? "preparing";
  const ratio = progress?.ratio ?? 0;

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={() => undefined}
      title="Opening Studio"
      size="sm"
      isLoading
      closeOnOverlayClick={false}
    >
      <VStack gap={4} align="stretch" py={2}>
        <Text fontSize="sm" color={theme.text.muted}>
          {PHASE_LABELS[phase]}
        </Text>
        <ClipperProgressBar label="Progress" value={ratio} />
      </VStack>
    </StyledModal>
  );
}
