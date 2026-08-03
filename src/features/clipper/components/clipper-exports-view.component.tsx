import React, { useCallback, useEffect } from "react";
import { VStack } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import type { ClipperFormatResult } from "../shared/state.util";
import { ClipperExportHistoryList } from "./clipper-export-history-list.component";
import { ClipperExportsScreenHeader } from "./clipper-exports-screen-header.component";
import { openClipperExportsDir } from "../persistence/export-files.util";

interface ClipperExportsViewProps {
  exportHistory: ClipperFormatResult[];
  sourceFileName: string | null;
  projectId: string;
  onRefreshHistory: () => void;
}

export const ClipperExportsView: React.FC<ClipperExportsViewProps> = ({
  exportHistory,
  sourceFileName,
  projectId,
  onRefreshHistory,
}) => {
  const navigate = useNavigate();
  const totalExports = exportHistory.length;

  useEffect(() => {
    onRefreshHistory();
  }, [onRefreshHistory]);

  const handleOpenFolder = useCallback(async () => {
    await openClipperExportsDir(projectId);
  }, [projectId]);

  const handleGoToPublish = useCallback(() => {
    navigate("/clipper?tab=publish");
  }, [navigate]);

  const description = sourceFileName
    ? `${totalExports} file${totalExports !== 1 ? "s" : ""} from ${sourceFileName} — saved to your project exports folder.`
    : "Rendered files are saved to your project exports folder.";

  return (
    <VStack align="stretch" gap={6}>
      <ClipperExportsScreenHeader
        title="Exports"
        description={description}
        onOpenFolder={() => void handleOpenFolder()}
        onGoToPublish={handleGoToPublish}
      />

      <ClipperExportHistoryList exports={exportHistory} />
    </VStack>
  );
};
