import React from "react";
import { VStack } from "@chakra-ui/react";
import type { ClipperFormatResult } from "../shared/state.util";
import { ClipperExportFormatRow } from "./clipper-export-format-row.component";

interface ClipperExportHistoryListProps {
  exports: ClipperFormatResult[];
}

export const ClipperExportHistoryList: React.FC<ClipperExportHistoryListProps> = ({ exports }) => {
  return (
    <VStack align="stretch" gap={2}>
      {exports.map((result) => (
        <ClipperExportFormatRow
          key={result.id}
          result={result}
          isRerendering={false}
          onRerender={() => {}}
        />
      ))}
    </VStack>
  );
};
