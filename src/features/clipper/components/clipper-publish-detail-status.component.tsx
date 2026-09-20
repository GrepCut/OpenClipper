import React from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import type {
  ClipperExportMapItem,
  ClipperExportPublishRecord,
} from "../persistence/clipper-export-db-api.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  getMapPublishTargets,
  mapPublishPlatformLabel,
  publishRecordForPlatform,
  succeededPublishesOutsideMapTargets,
} from "../shared/clipper-map-publish.util";

interface ClipperPublishDetailStatusProps {
  item: ClipperExportMapItem;
}

export function ClipperPublishDetailStatus({ item }: ClipperPublishDetailStatusProps) {
  const { theme } = useClipperUi();
  const published: ClipperExportPublishRecord[] = [
    ...getMapPublishTargets(item.formatId)
      .map((platform) => publishRecordForPlatform(item, platform))
      .filter((record): record is ClipperExportPublishRecord => record?.status === "succeeded"),
    ...succeededPublishesOutsideMapTargets(item),
  ];

  if (published.length === 0) return null;

  return (
    <VStack align="stretch" gap={2}>
      {published.map((record) => (
        <HStack
          key={record.platform}
          gap={2}
          p={3}
          borderRadius="xl"
          bg="rgba(34, 197, 94, 0.12)"
          border="1px solid"
          borderColor="rgba(34, 197, 94, 0.35)"
        >
          <CheckCircle2 size={18} color="#22c55e" />
          <Text fontSize="sm" color={theme.text.primary} flex={1}>
            Published to {mapPublishPlatformLabel(record.platform, item.formatId)}
          </Text>
          {record.watchUrl ? (
            <Box asChild>
              <a href={record.watchUrl} target="_blank" rel="noopener noreferrer">
                <OutlinedActionButton size="sm" startIcon={<ExternalLink size={14} />}>
                  Open
                </OutlinedActionButton>
              </a>
            </Box>
          ) : null}
        </HStack>
      ))}
    </VStack>
  );
}
