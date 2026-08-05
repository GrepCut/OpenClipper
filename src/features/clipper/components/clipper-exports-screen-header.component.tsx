import React from "react";
import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { FolderOpen, Send } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

interface ClipperExportsScreenHeaderProps {
  title: string;
  description: string;
  onOpenFolder: () => void;
  onGoToPublish: () => void;
}

export function ClipperExportsScreenHeader({
  title,
  description,
  onOpenFolder,
  onGoToPublish,
}: ClipperExportsScreenHeaderProps) {
  const { theme, outlineButton } = useClipperUi();

  return (
    <Box>
      <HStack justify="space-between" mb={2} flexWrap="wrap" gap={3}>
        <Text fontSize="lg" fontWeight="semibold" color={theme.text.primary}>
          {title}
        </Text>
        <HStack gap={2} flexWrap="wrap">
          <Button
            size="sm"
            borderRadius="xl"
            {...outlineButton}
            onClick={() => void onOpenFolder()}
          >
            <HStack gap={2}>
              <FolderOpen size={16} />
              <Text>Open folder</Text>
            </HStack>
          </Button>
          <Button size="sm" borderRadius="xl" {...outlineButton} onClick={onGoToPublish}>
            <HStack gap={2}>
              <Send size={16} />
              <Text>Publish</Text>
            </HStack>
          </Button>
        </HStack>
      </HStack>
      <Text color={theme.text.muted}>{description}</Text>
    </Box>
  );
}
