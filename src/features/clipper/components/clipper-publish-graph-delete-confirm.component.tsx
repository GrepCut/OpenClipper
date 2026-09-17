import React from "react";
import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { Trash2, X } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

const POPUP_OFFSET_X = 30;

interface ClipperPublishGraphDeleteConfirmProps {
  screenX: number;
  screenY: number;
  onCancel: () => void;
}

export function ClipperPublishGraphDeleteConfirm({
  screenX,
  screenY,
  onCancel,
}: ClipperPublishGraphDeleteConfirmProps) {
  const { theme } = useClipperUi();

  return (
    <Box
      position="absolute"
      left={`${screenX + POPUP_OFFSET_X}px`}
      top={`${screenY}px`}
      transform="translateY(-50%)"
      zIndex={2}
      pointerEvents="auto"
      maxW="220px"
      px={3}
      py={2.5}
      borderRadius="xl"
      border="1px solid"
      borderColor="rgba(239, 68, 68, 0.45)"
      bg={theme.background.tertiary}
      boxShadow={theme.shadow.panel}
    >
      <HStack align="start" gap={2}>
        <Box pt={0.5} color={theme.status.danger} flexShrink={0}>
          <Trash2 size={14} />
        </Box>
        <VStack align="start" gap={1} flex={1} minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color={theme.text.primary} lineHeight="short">
            Press Delete again to remove this export.
          </Text>
          <Text fontSize="2xs" color={theme.text.muted}>
            Esc to cancel
          </Text>
        </VStack>
        <IconButton
          aria-label="Cancel delete"
          size="2xs"
          variant="ghost"
          color={theme.text.muted}
          minW="24px"
          h="24px"
          onClick={onCancel}
          _hover={{ color: theme.text.primary, bg: theme.surface.hover }}
        >
          <X size={14} />
        </IconButton>
      </HStack>
    </Box>
  );
}
