import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperFormatResult } from "../shared/state";
import { ClipperExportFormatRow, type ClipperPublishTarget } from "./ClipperExportFormatRow";

interface ClipperExportHistoryListProps {
  exports: ClipperFormatResult[];
  onOpenFolder: () => void;
  onPublish: (result: ClipperFormatResult, target: ClipperPublishTarget) => void;
}

export const ClipperExportHistoryList: React.FC<ClipperExportHistoryListProps> = ({
  exports,
  onOpenFolder,
  onPublish,
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
        />
      ))}
    </VStack>
  );
};
