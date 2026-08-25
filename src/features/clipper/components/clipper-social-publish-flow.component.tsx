import React from "react";
import type { ClipperSocialPublishDialogProps } from "./clipper-social-publish-dialog.constants";
import { ClipperSocialPublishFormDialog } from "./clipper-social-publish-form-dialog.component";
import { ClipperSocialPublishProgressDialog } from "./clipper-social-publish-progress-dialog.component";
import { ClipperSocialPublishSuccessDialog } from "./clipper-social-publish-success-dialog.component";
import { useClipperSocialPublish } from "./use-clipper-social-publish.hook";

export function ClipperSocialPublishDialog({
  isOpen,
  onClose,
  projectId,
  result,
  sourceFileName,
  defaultConnected,
  accountLabel,
  accountConnections,
  ownerChannelLabel,
  publishPlatform: requestedPlatform,
  onRequestConnect,
  onPublishComplete,
}: ClipperSocialPublishDialogProps) {
  const publish = useClipperSocialPublish({
    isOpen,
    result,
    sourceFileName,
    defaultConnected,
    accountConnections,
    requestedPlatform,
    projectId,
    onRequestConnect,
    onPublishComplete,
  });

  const showSuccess =
    isOpen && publish.usesPublishModals && publish.didSucceed && !publish.isPublishing;
  const showProgress = isOpen && publish.usesPublishModals && publish.isPublishing;
  const showForm = isOpen && !showProgress && !showSuccess;

  return (
    <>
      <ClipperSocialPublishFormDialog
        isOpen={showForm}
        onClose={onClose}
        result={result}
        defaultConnected={defaultConnected}
        accountLabel={accountLabel}
        ownerChannelLabel={ownerChannelLabel}
        onRequestConnect={onRequestConnect}
        publish={publish}
        showInlineProgress={!publish.usesPublishModals}
      />
      <ClipperSocialPublishProgressDialog
        isOpen={showProgress}
        platformLabel={publish.platformLabel}
        uploadPhase={publish.uploadPhase}
        uploadProgress={publish.uploadProgress}
      />
      <ClipperSocialPublishSuccessDialog
        isOpen={showSuccess}
        onClose={onClose}
        platformLabel={publish.platformLabel}
        watchUrl={publish.watchUrl}
      />
    </>
  );
}
