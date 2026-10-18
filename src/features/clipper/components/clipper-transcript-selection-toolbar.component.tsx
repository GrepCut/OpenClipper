import React from "react";
import { Box, HStack } from "@chakra-ui/react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export interface ClipperTranscriptSelectionToolbarProps {
  top: number;
  left: number;
  canEdit: boolean;
  canDelete: boolean;
  canRestore: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
}

function ToolbarButton({
  label,
  icon,
  tone = "default",
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <OutlinedActionButton
      tone={tone}
      startIcon={icon}
      h="26px"
      px={2}
      gap={1.5}
      fontSize="xs"
      onClick={onClick}
    >
      {label}
    </OutlinedActionButton>
  );
}

/** Floating actions above a word selection: edit, delete/restore. */
export function ClipperTranscriptSelectionToolbar({
  top,
  left,
  canEdit,
  canDelete,
  canRestore,
  onEdit,
  onDelete,
  onRestore,
}: ClipperTranscriptSelectionToolbarProps) {
  const { theme } = useClipperUi();
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <Box
      position="absolute"
      top={`${top}px`}
      left={`${left}px`}
      zIndex={3}
      onClick={stop}
      onPointerDown={(event) => {
        event.stopPropagation();
        // Keep focus on the transcript so its keyboard shortcuts keep working.
        event.preventDefault();
      }}
      onDoubleClick={stop}
    >
      <HStack
        role="toolbar"
        aria-label="Transcript selection actions"
        gap={0.5}
        p={0.5}
        bg={theme.background.tertiary}
        border="1px solid"
        borderColor={theme.border.primary}
        borderRadius="2xl"
        boxShadow="0 6px 20px rgba(0,0,0,0.35)"
        whiteSpace="nowrap"
      >
        {canEdit ? (
          <ToolbarButton label="Edit" icon={<Pencil size={12} />} onClick={onEdit} />
        ) : null}
        {canDelete ? (
          <ToolbarButton
            label="Delete"
            tone="danger"
            icon={<Trash2 size={12} />}
            onClick={onDelete}
          />
        ) : null}
        {canRestore ? (
          <ToolbarButton
            label="Restore"
            icon={<RotateCcw size={12} />}
            onClick={onRestore}
          />
        ) : null}
      </HStack>
    </Box>
  );
}
