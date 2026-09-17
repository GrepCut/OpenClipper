import React from "react";
import { HStack } from "@chakra-ui/react";
import { Play, RotateCcw, Square } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";

interface ClipperRenderQueueActionsProps {
  isRendering: boolean;
  hasPendingJobs: boolean;
  onStop?: () => void;
  onContinue?: () => void;
  onRestart?: () => void;
}

export const ClipperRenderQueueActions: React.FC<ClipperRenderQueueActionsProps> = ({
  isRendering,
  hasPendingJobs,
  onStop,
  onContinue,
  onRestart,
}) => {
  if (isRendering) {
    return (
      <OutlinedActionButton startIcon={<Square size={16} />} onClick={onStop}>
        Stop
      </OutlinedActionButton>
    );
  }

  if (!hasPendingJobs) return null;

  return (
    <HStack gap={2} flexWrap="wrap">
      {onContinue ? (
        <OutlinedActionButton startIcon={<Play size={16} />} onClick={onContinue}>
          Continue
        </OutlinedActionButton>
      ) : null}
      {onRestart ? (
        <OutlinedActionButton startIcon={<RotateCcw size={16} />} onClick={onRestart}>
          Render from scratch
        </OutlinedActionButton>
      ) : null}
    </HStack>
  );
};
