import React, { useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { appToast } from "../../../shared/utils/toast.service";
import { revealClipperExportInFolder } from "../persistence/export-files-open.util";

interface ClipperExportRevealButtonProps {
  projectId: string;
  fileName: string;
  disabled?: boolean;
}

export function ClipperExportRevealButton({
  projectId,
  fileName,
  disabled = false,
}: ClipperExportRevealButtonProps) {
  const handleRevealInFolder = useCallback(async () => {
    try {
      await revealClipperExportInFolder(projectId, fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appToast.error("Reveal in folder failed", message || "Could not reveal the export file.");
    }
  }, [projectId, fileName]);

  return (
    <OutlinedActionButton
      width="100%"
      justifyContent="center"
      whiteSpace="nowrap"
      startIcon={<FolderOpen size={16} />}
      onClick={() => void handleRevealInFolder()}
      disabled={disabled}
    >
      Reveal in folder
    </OutlinedActionButton>
  );
}
