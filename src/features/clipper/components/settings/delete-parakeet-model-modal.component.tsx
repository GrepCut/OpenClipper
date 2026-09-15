import { useState } from "react";
import { Text, VStack } from "@chakra-ui/react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../../shared/components/styled-modal.component";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";

interface DeleteParakeetModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title?: string;
  message?: string;
}

export function DeleteParakeetModelModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Delete speech model",
  message = "Remove Parakeet from this device? Captions will need the ~671 MB download again.",
}: DeleteParakeetModelModalProps) {
  const { theme } = useClipperUi();
  const [isLoading, setIsLoading] = useState(false);

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) onClose();
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="md"
      isLoading={isLoading}
      footer={
        <StyledModalFooter
          onCancel={handleClose}
          onSubmit={() => void handleDelete()}
          submitText="Delete"
          isLoading={isLoading}
          submitColorScheme="red"
        />
      }
    >
      <VStack gap={3} align="stretch">
        <Text color={theme.text.primary} lineHeight="1.6">
          {message}
        </Text>
      </VStack>
    </StyledModal>
  );
}
