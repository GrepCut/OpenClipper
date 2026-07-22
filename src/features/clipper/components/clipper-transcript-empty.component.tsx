import React from "react";
import { Text } from "@chakra-ui/react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

interface ClipperTranscriptEmptyProps {
  message?: string;
}

export function ClipperTranscriptEmpty({
  message = "No speech detected in this range.",
}: ClipperTranscriptEmptyProps) {
  const { theme } = useClipperUi();

  return (
    <Text fontSize="sm" color={theme.text.muted} fontStyle="italic">
      {message}
    </Text>
  );
}
