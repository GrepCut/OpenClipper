import { Text, VStack } from "@chakra-ui/react";
import { StyledModal } from "../../../shared/components/styled-modal.component";
import type { SocialPublishUploadPhase } from "../shared/run-clipper-social-publish.util";
import { ClipperSocialPublishStatus } from "./clipper-social-publish-status.component";

export function ClipperSocialPublishProgressDialog({
  isOpen,
  platformLabel,
  uploadPhase,
  uploadProgress,
}: {
  isOpen: boolean;
  platformLabel: string;
  uploadPhase: SocialPublishUploadPhase;
  uploadProgress: number;
}) {
  return (
    <StyledModal
      isOpen={isOpen}
      onClose={() => undefined}
      title={`Publishing to ${platformLabel}…`}
      size="sm"
      isLoading
      closeOnOverlayClick={false}
    >
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm">
          Keep this window open. Your clip is uploading and cannot be posted twice.
        </Text>
        <ClipperSocialPublishStatus
          isPublishing
          uploadPhase={uploadPhase}
          uploadProgress={uploadProgress}
          platformLabel={platformLabel}
        />
      </VStack>
    </StyledModal>
  );
}
