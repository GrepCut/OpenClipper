import React, { useEffect, useState } from "react";
import { Box, HStack, Input, Slider, Text, VStack } from "@chakra-ui/react";
import {
  AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC,
  AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC,
  normalizeAutoPartsSegmentLengthSec,
} from "../engine/segmentation";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";

interface ClipperCustomSegmentLengthModalProps {
  isOpen: boolean;
  value: number;
  onClose: () => void;
  onApply: (lengthSec: number) => void;
}

function clampDraft(value: number): number {
  return normalizeAutoPartsSegmentLengthSec(value);
}

export const ClipperCustomSegmentLengthModal: React.FC<
  ClipperCustomSegmentLengthModalProps
> = ({ isOpen, value, onClose, onApply }) => {
  const { theme } = useClipperUi();
  const [draft, setDraft] = useState(() => clampDraft(value));

  useEffect(() => {
    if (isOpen) setDraft(clampDraft(value));
  }, [isOpen, value]);

  const handleApply = () => {
    onApply(clampDraft(draft));
    onClose();
  };

  const setDraftFromInput = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    setDraft(clampDraft(parsed));
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={onClose}
      title="Custom clip length"
      size="sm"
      footer={
        <StyledModalFooter
          onCancel={onClose}
          onSubmit={handleApply}
          submitText="Apply"
        />
      }
    >
      <VStack align="stretch" gap={5}>
        <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
          Set how long each auto-part clip should be. Shorter values create more clips.
        </Text>

        <Box
          p={4}
          borderRadius="xl"
          bg={theme.surface.subtle}
          border="1px solid"
          borderColor={theme.border.primary}
        >
          <VStack align="stretch" gap={4}>
            <HStack justify="center" align="baseline" gap={2}>
              <Input
                type="number"
                inputMode="numeric"
                min={AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC}
                max={AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC}
                step={1}
                value={draft}
                onChange={(e) => setDraftFromInput(e.target.value)}
                w="88px"
                textAlign="center"
                fontSize="2xl"
                fontWeight="700"
                letterSpacing="-0.02em"
                borderRadius="xl"
                bg={theme.background.tertiary}
                borderColor={theme.surface.borderStrong}
                color={clipperTheme.accentLight}
                py={2}
                _focus={{
                  borderColor: clipperTheme.accent,
                  boxShadow: `0 0 0 1px ${clipperTheme.accent}`,
                }}
              />
              <Text fontSize="sm" color={theme.text.muted} fontWeight="medium">
                seconds
              </Text>
            </HStack>

            <Box px={1}>
              <Slider.Root
                min={AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC}
                max={AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC}
                step={1}
                value={[draft]}
                onValueChange={(details) => setDraft(clampDraft(details.value[0] ?? draft))}
              >
                <Slider.Control>
                  <Slider.Track bg={theme.surface.active} borderRadius="full" h="6px">
                    <Slider.Range bg={clipperTheme.accent} />
                  </Slider.Track>
                  <Slider.Thumb index={0} />
                </Slider.Control>
              </Slider.Root>
              <HStack justify="space-between" mt={2}>
                <Text fontSize="xs" color={theme.text.muted}>
                  {AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC}s
                </Text>
                <Text fontSize="xs" color={theme.text.muted}>
                  {AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC}s
                </Text>
              </HStack>
            </Box>
          </VStack>
        </Box>
      </VStack>
    </StyledModal>
  );
};
