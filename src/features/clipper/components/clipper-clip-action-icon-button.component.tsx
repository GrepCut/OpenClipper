import React from "react";
import { IconButton, type IconButtonProps } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

/** Borderless icon action in a clip card header (Open in Studio / Edit / Delete). */
export function ClipActionIconButton({
  tone = "default",
  ...props
}: IconButtonProps & { tone?: "default" | "danger" }) {
  const { theme } = useClipperUi();
  const color = tone === "danger" ? theme.status.danger : theme.text.muted;
  const hoverColor = tone === "danger" ? theme.status.danger : clipperTheme.accentLight;

  return (
    <IconButton
      size="xs"
      variant="ghost"
      borderRadius="md"
      color={color}
      bg="transparent"
      border="none"
      flexShrink={0}
      alignSelf="flex-end"
      minW="0"
      w="auto"
      h="auto"
      p={1}
      _hover={{ bg: "transparent", color: hoverColor, opacity: 0.85 }}
      {...props}
    />
  );
}
