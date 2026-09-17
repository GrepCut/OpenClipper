import React from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import type { SocialPublishablePlatform } from "../../../services/types/social-auth.types";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import type { ClipperExportMapItem } from "../persistence/clipper-export-db-api.util";
import { ClipperPublishMetadataIncompleteTag } from "./clipper-publish-metadata-incomplete-tag.component";
import type { OwnerPublishConnectionResult } from "../shared/clipper-owner-channels.util";
import { getOwnerPublishBlockedMessage } from "../shared/resolve-owner-publish-connection.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperPlatformIcon } from "./clipper-platform-icon.component";
import { ClipperExportRevealButton } from "./clipper-export-reveal-button.component";
import { ClipperPublishExportThumb } from "./clipper-publish-export-thumb.component";
import { getBadgePlatformsForFormat, getClipperFormatDef } from "../shared/formats.util";
import {
  areMapTargetsPublished,
  getMapPublishTargets,
  isPlatformPublished,
  mapPublishPlatformLabel,
  publishRecordForPlatform,
  succeededPublishesOutsideMapTargets,
} from "../shared/clipper-map-publish.util";

interface ClipperPublishProjectExportRowProps {
  item: ClipperExportMapItem;
  hasOwner: boolean;
  canPublish: boolean;
  publishLoadingExportId: string | null;
  connections: Map<string, OwnerPublishConnectionResult>;
  thumbnail?: HTMLCanvasElement;
  onPublishExport: (item: ClipperExportMapItem, platform: SocialPublishablePlatform) => void;
  onSelectExport: (exportId: string) => void;
}

function PublishedPlatformLine({
  label,
  watchUrl,
}: {
  label: string;
  watchUrl?: string | null;
}) {
  const { theme } = useClipperUi();
  return (
    <HStack gap={2} justify="space-between">
      <HStack gap={2} minW={0}>
        <CheckCircle2 size={16} color="#22c55e" />
        <Text fontSize="sm" color={theme.text.primary} lineClamp={1}>
          {label}
        </Text>
      </HStack>
      {watchUrl ? (
        <Box asChild>
          <a href={watchUrl} target="_blank" rel="noopener noreferrer">
            <OutlinedActionButton size="sm" startIcon={<ExternalLink size={14} />}>
              Open
            </OutlinedActionButton>
          </a>
        </Box>
      ) : (
        <Text fontSize="xs" color={theme.text.muted}>
          Published
        </Text>
      )}
    </HStack>
  );
}

export function ClipperPublishProjectExportRow({
  item,
  hasOwner,
  canPublish,
  publishLoadingExportId,
  connections,
  thumbnail,
  onPublishExport,
  onSelectExport,
}: ClipperPublishProjectExportRowProps) {
  const { theme } = useClipperUi();
  const formatDef = getClipperFormatDef(item.formatId);
  const badgePlatforms = getBadgePlatformsForFormat(item.formatId);
  const targets = getMapPublishTargets(item.formatId);
  const isFolderOnly = targets.length === 0;
  const showMetadataWarning =
    !isFolderOnly && !areMapTargetsPublished(item) && item.missingFields.length > 0;
  const blockedHint = hasOwner
    ? targets
        .filter((platform) => !isPlatformPublished(item, platform))
        .map((platform) => {
          const connection = connections.get(`${item.id}:${platform}`);
          if (!connection) return null;
          const message = getOwnerPublishBlockedMessage(platform, connection);
          return message ? `${mapPublishPlatformLabel(platform, item.formatId)}: ${message}` : null;
        })
        .find((hint): hint is string => Boolean(hint))
    : undefined;
  const otherPublishes = succeededPublishesOutsideMapTargets(item);

  return (
    <HStack
      align="center"
      gap={3}
      borderRadius="xl"
      border="1px solid"
      borderColor={theme.surface.hover}
      bg={theme.surface.faint}
      px={3.5}
      py={3}
    >
      <ClipperPublishExportThumb
        clipIndex={item.clipIndex}
        thumbnail={thumbnail}
        onPreview={() => onSelectExport(item.id)}
      />

      <VStack align="stretch" gap={2.5} flex={1} minW={0}>
        <HStack align="center" gap={2}>
          {formatDef ? (
            <HStack gap={0.5} flexShrink={0}>
              {(badgePlatforms.length > 0 ? badgePlatforms : [formatDef.platform]).map(
                (platform) => (
                  <ClipperPlatformIcon key={platform} platform={platform} size={16} />
                ),
              )}
            </HStack>
          ) : null}
          <VStack align="start" gap={0.5} flex={1} minW={0}>
            <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} lineClamp={1}>
              {item.formatLabel}
            </Text>
            <Text fontSize="xs" color={theme.text.muted}>
              Clip {item.clipIndex + 1}
            </Text>
          </VStack>
        </HStack>

        <VStack align="stretch" gap={2}>
          {targets.map((platform) => {
            const label = mapPublishPlatformLabel(platform, item.formatId);
            if (isPlatformPublished(item, platform)) {
              return (
                <PublishedPlatformLine
                  key={platform}
                  label={label}
                  watchUrl={publishRecordForPlatform(item, platform)?.watchUrl}
                />
              );
            }

            const connection = connections.get(`${item.id}:${platform}`);
            const channelConnected = connection?.connected ?? false;
            return (
              <OutlinedActionButton
                key={platform}
                width="100%"
                justifyContent="center"
                loading={publishLoadingExportId === `${item.id}:${platform}`}
                onClick={() => onPublishExport(item, platform)}
                disabled={!hasOwner || !canPublish || !channelConnected}
              >
                Publish to {label}
              </OutlinedActionButton>
            );
          })}

          {otherPublishes.map((record) => (
            <PublishedPlatformLine
              key={record.platform}
              label={mapPublishPlatformLabel(record.platform, item.formatId)}
              watchUrl={record.watchUrl}
            />
          ))}

          {isFolderOnly ? (
            <>
              <ClipperExportRevealButton projectId={item.projectId} fileName={item.fileName} />
              <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5" px={0.5}>
                In-app publishing is available for TikTok and YouTube. Upload this file manually.
              </Text>
            </>
          ) : null}
        </VStack>

        {showMetadataWarning ? (
          <ClipperPublishMetadataIncompleteTag onClick={() => onSelectExport(item.id)} />
        ) : null}

        {blockedHint ? (
          <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5" px={0.5}>
            {blockedHint}
          </Text>
        ) : null}
      </VStack>
    </HStack>
  );
}
