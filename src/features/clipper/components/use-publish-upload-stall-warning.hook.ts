import { useEffect, useRef } from "react";
import { appToast } from "../../../shared/utils/toast.service";
import type { SocialPublishUploadPhase } from "../shared/run-clipper-social-publish.util";

const UPLOAD_STALL_WARNING_MS = 30_000;

export function usePublishUploadStallWarning(
  isPublishing: boolean,
  uploadPhase: SocialPublishUploadPhase,
  uploadProgress: number,
): void {
  const lastUploadProgressRef = useRef(0);
  const lastUploadProgressAtRef = useRef(0);
  const uploadStallWarnedRef = useRef(false);

  useEffect(() => {
    if (!isPublishing) {
      uploadStallWarnedRef.current = false;
      return;
    }
    lastUploadProgressRef.current = uploadProgress;
    lastUploadProgressAtRef.current = Date.now();
    uploadStallWarnedRef.current = false;
  }, [isPublishing]);

  useEffect(() => {
    if (!isPublishing || uploadPhase !== "uploading") return;
    const interval = window.setInterval(() => {
      if (uploadProgress !== lastUploadProgressRef.current) {
        lastUploadProgressRef.current = uploadProgress;
        lastUploadProgressAtRef.current = Date.now();
        uploadStallWarnedRef.current = false;
        return;
      }
      if (
        uploadProgress < 1
        && !uploadStallWarnedRef.current
        && Date.now() - lastUploadProgressAtRef.current >= UPLOAD_STALL_WARNING_MS
      ) {
        uploadStallWarnedRef.current = true;
        appToast.info(
          "Upload still in progress",
          "Your video is still uploading. Large clips can take a few minutes.",
        );
      }
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [isPublishing, uploadPhase, uploadProgress]);
}
