import React, { useCallback, useEffect, useState } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Plug } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { useTheme } from "../../../theme";
import { appToast } from "../../../shared/utils/toast.service";
import type { ClipperOwnerChannelRecord } from "../persistence/clipper-owner-db-api.util";
import {
  type AvailableOwnerChannel,
  ownerChannelKey,
  platformLabel,
} from "../shared/clipper-owner-channels.util";
import { ClipperOwnerChannelPlatformIcon } from "./clipper-owner-channel-platform-icon.component";

interface ClipperOwnerChannelPickerProps {
  availableChannels: AvailableOwnerChannel[];
  linkedChannels: ClipperOwnerChannelRecord[];
  onSelectionChange: (selected: AvailableOwnerChannel[]) => Promise<void>;
  onOpenIntegrations: () => void;
}

export function ClipperOwnerChannelPicker({
  availableChannels,
  linkedChannels,
  onSelectionChange,
  onOpenIntegrations,
}: ClipperOwnerChannelPickerProps) {
  const { theme, mode } = useTheme();
  const rowBg = mode === "dark" ? theme.background.card : "gray.50";
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectedKeys(new Set(linkedChannels.map((channel) => ownerChannelKey(channel))));
  }, [linkedChannels]);

  const toggleChannel = useCallback(async (channel: AvailableOwnerChannel) => {
    if (saving) return;

    const key = ownerChannelKey(channel);
    const previousKeys = selectedKeys;
    const next = new Set(selectedKeys);

    if (next.has(key)) {
      next.delete(key);
    } else {
      for (const existing of availableChannels) {
        if (existing.platform === channel.platform) {
          next.delete(ownerChannelKey(existing));
        }
      }
      next.add(key);
    }

    const nextSelected = availableChannels.filter((item) => next.has(ownerChannelKey(item)));
    setSelectedKeys(next);
    setSaving(true);

    try {
      await onSelectionChange(nextSelected);
    } catch {
      setSelectedKeys(previousKeys);
      appToast.error("Failed to save", "Could not update channels.");
    } finally {
      setSaving(false);
    }
  }, [availableChannels, onSelectionChange, saving, selectedKeys]);

  return (
    <VStack align="stretch" gap={6} flex="1" minH={0}>
      <VStack align="start" gap={2} maxW="640px">
        <SecondaryMainTitle
          fontSize={{ base: "2xl", md: "3xl" }}
          fontWeight="bold"
          color={theme.text.primary}
        >
          Manage channels
        </SecondaryMainTitle>
        <Text color={theme.text.muted}>
          Choose integrated accounts to link to this owner. Changes save automatically.
        </Text>
      </VStack>

      {availableChannels.length === 0 ? (
        <Box bg={rowBg} borderRadius="2xl" p={{ base: 6, md: 8 }}>
          <VStack align="start" gap={3}>
            <Text fontWeight="semibold" color={theme.text.primary}>
              No integrated accounts yet
            </Text>
            <Text fontSize="sm" color={theme.text.muted}>
              Connect YouTube, Instagram, TikTok, or other platforms on the Integrations tab first.
            </Text>
            <OutlinedActionButton
              alignSelf="flex-start"
              startIcon={<Plug size={16} />}
              onClick={onOpenIntegrations}
            >
              Open Integrations
            </OutlinedActionButton>
          </VStack>
        </Box>
      ) : (
        <VStack align="stretch" gap={3} opacity={saving ? 0.7 : 1} pointerEvents={saving ? "none" : "auto"}>
          {availableChannels.map((channel) => {
            const key = ownerChannelKey(channel);
            const isSelected = selectedKeys.has(key);
            return (
              <Box
                key={key}
                as="button"
                type="button"
                onClick={() => void toggleChannel(channel)}
                bg={isSelected ? theme.surface.faint : rowBg}
                borderRadius="2xl"
                p={{ base: 4, md: 5 }}
                textAlign="left"
                w="full"
                outline={isSelected ? `2px solid ${theme.brand.purpleSoftAlpha12}` : "none"}
              >
                <HStack justify="space-between" align="center" gap={4}>
                  <HStack gap={3} minW={0} flex={1}>
                    <ClipperOwnerChannelPlatformIcon platform={channel.platform} size={24} />
                    <VStack align="start" gap={0.5} minW={0}>
                      <Text fontWeight="semibold" color={theme.text.primary} lineClamp={1}>
                        {platformLabel(channel.platform)}
                      </Text>
                      <Text fontSize="sm" color={theme.text.muted} lineClamp={1}>
                        {channel.displayName}
                      </Text>
                    </VStack>
                  </HStack>
                  {isSelected ? (
                    <Box color={theme.text.primary} flexShrink={0}>
                      <Check size={20} />
                    </Box>
                  ) : null}
                </HStack>
              </Box>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}
