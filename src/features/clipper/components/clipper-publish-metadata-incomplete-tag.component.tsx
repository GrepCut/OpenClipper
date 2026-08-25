import React from "react";
import { Flex, Text } from "@chakra-ui/react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

interface ClipperPublishMetadataIncompleteTagProps {
  onClick: () => void;
}

export function ClipperPublishMetadataIncompleteTag({
  onClick,
}: ClipperPublishMetadataIncompleteTagProps) {
  const { theme } = useClipperUi();
  const warningColor = theme.status.warning;

  return (
    <Flex
      as="button"
      type="button"
      onClick={onClick}
      align="center"
      gap={1.5}
      px={2.5}
      py={1}
      w="fit-content"
      borderRadius="full"
      bg="rgba(255, 149, 0, 0.1)"
      border="1px solid"
      borderColor="rgba(255, 149, 0, 0.28)"
      cursor="pointer"
      _hover={{ bg: "rgba(255, 149, 0, 0.18)" }}
      aria-label="Complete missing metadata"
      title="Complete missing metadata"
    >
      <AlertTriangle size={12} color={warningColor} />
      <Text fontSize="xs" fontWeight="semibold" color={warningColor} lineHeight="1.2">
        Metadata incomplete
      </Text>
      <ChevronRight size={14} color={warningColor} />
    </Flex>
  );
}
