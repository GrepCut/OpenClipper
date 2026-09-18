import React from "react";
import { HStack, IconButton } from "@chakra-ui/react";
import { Maximize, Minus, Plus } from "lucide-react";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { PublishGraphZoomAction } from "./clipper-publish-graph-gestures.util";

interface ClipperPublishGraphZoomControlsProps {
  onZoomAction: (action: PublishGraphZoomAction) => void;
}

const CONTROLS: Array<{ action: PublishGraphZoomAction; label: string; icon: React.ReactNode }> = [
  { action: "zoom-out", label: "Zoom out (Ctrl -)", icon: <Minus size={14} /> },
  { action: "zoom-in", label: "Zoom in (Ctrl +)", icon: <Plus size={14} /> },
  { action: "fit", label: "Fit to view (Shift Z)", icon: <Maximize size={14} /> },
];

export function ClipperPublishGraphZoomControls({ onZoomAction }: ClipperPublishGraphZoomControlsProps) {
  const { theme } = useClipperUi();

  return (
    <HStack
      position="absolute"
      right={3}
      bottom={3}
      zIndex={2}
      gap={0.5}
      p={0.5}
      borderRadius="lg"
      border="1px solid"
      borderColor={theme.border.primary}
      bg={theme.background.tertiary}
      boxShadow={theme.shadow.panel}
    >
      {CONTROLS.map(({ action, label, icon }) => (
        <IconButton
          key={action}
          aria-label={label}
          title={label}
          size="2xs"
          variant="ghost"
          color={theme.text.muted}
          minW="26px"
          h="26px"
          onClick={() => onZoomAction(action)}
          _hover={{ color: theme.text.primary, bg: theme.surface.hover }}
        >
          {icon}
        </IconButton>
      ))}
    </HStack>
  );
}
