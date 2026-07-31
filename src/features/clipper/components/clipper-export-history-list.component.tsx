import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ExportSocialFields } from "../persistence/clipper-export-social.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { ClipperExportFormatRow, type ClipperPublishTarget } from "./clipper-export-format-row.component";

interface ClipperExportHistoryListProps {
  exports: ClipperFormatResult[];
  onOpenFolder: () => void;
  onPublish: (result: ClipperFormatResult, target: ClipperPublishTarget) => void;
  onMetadataSaved: (exportId: string, fields: ExportSocialFields) => void;
}

export const ClipperExportHistoryList: React.FC<ClipperExportHistoryListProps> = ({
  exports,
  onOpenFolder,
  onPublish,
  onMetadataSaved,
}) => {
  return (
    <VStack align="stretch" gap={2}>
      {exports.map((result) => (
        <ClipperExportFormatRow
          key={result.id}
          result={result}
          isRerendering={false}
          onOpenFolder={onOpenFolder}
          onPublish={onPublish}
          onRerender={() => {}}
          onMetadataSaved={onMetadataSaved}
        />
      ))}
    </VStack>
  );
};
