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
}

export function DeleteParakeetModelModal({
  isOpen,
  onClose,
  onConfirm,
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
      title="Delete speech model"
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
          Remove Parakeet from this device? Captions will need the ~671 MB download again.
        </Text>
      </VStack>
    </StyledModal>
  );
}
