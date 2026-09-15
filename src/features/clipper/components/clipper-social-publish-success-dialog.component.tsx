import { Text } from "@chakra-ui/react";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { openExternalUrl } from "../../../shared/utils/open-external-url.util";

export function ClipperSocialPublishSuccessDialog({
  isOpen,
  onClose,
  platformLabel,
  watchUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  platformLabel: string;
  watchUrl: string | null;
}) {
  const handleOpen = () => {
    if (watchUrl) {
      void openExternalUrl(watchUrl).catch(() => {
        window.open(watchUrl, "_blank", "noopener,noreferrer");
      });
    }
    onClose();
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Published to ${platformLabel}`}
      size="sm"
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={handleOpen}
          cancelText="Close"
          submitText={`Open on ${platformLabel}`}
          submitDisabled={!watchUrl}
        />
      }
    >
      <Text fontSize="sm">
        {watchUrl
          ? "Published successfully."
          : `Published successfully. ${platformLabel} may take a few more minutes before the post is visible.`}
      </Text>
    </StyledModal>
  );
}
