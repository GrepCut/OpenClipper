import React, { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Flex,
  HStack,
  Text,
  chakra,
} from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { ThinkingDots } from "./ThinkingDots";
import type { ClipperAiChatMessage, ClipperAiClipPickerModel } from "../persistence/ai-clip-api";
import { clipperAiContextUsage } from "../engine/ai-context-estimate";
import type { WordCue } from "../shared/state";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import { ClipperAiModelSelector } from "./ClipperAiModelSelector";
import {
  ClipperAiChatPanelToggle,
  type ClipperAiChatPanelView,
} from "./ClipperAiChatPanelToggle";

const AutoSizingTextarea = chakra(TextareaAutosize);

interface ClipperAiClipChatProps {
  messages: ClipperAiChatMessage[];
  loading: boolean;
  error: string | null;
  thinking?: string;
  progressChars?: number;
  model: ClipperAiClipPickerModel;
  onModelChange: (model: ClipperAiClipPickerModel) => void;
  onSend: (message: string, preset?: string) => void;
  panelView: ClipperAiChatPanelView;
  onPanelViewChange: (view: ClipperAiChatPanelView) => void;
  onClearContext?: () => void;
  rangeWords?: WordCue[];
  currentClipsJsonChars?: number;
}

export const ClipperAiClipChat: React.FC<ClipperAiClipChatProps> = ({
  messages,
  loading,
  error,
  thinking,
  progressChars,
  model,
  onModelChange,
  onSend,
  panelView,
  onPanelViewChange,
  onClearContext,
  rangeWords = [],
  currentClipsJsonChars = 0,
}) => {
  const { theme } = useClipperUi();
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const accent = clipperTheme.accent;

  const contextUsage = useMemo(
    () =>
      clipperAiContextUsage(rangeWords, {
        messages,
        userMessage: input,
        currentClipsJsonChars: currentClipsJsonChars,
      }),
    [rangeWords, messages, input, currentClipsJsonChars],
  );

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setInput("");
  };

  const loadingLabel = thinking
    ? "Generating clips…"
    : progressChars
      ? `Generating · ${progressChars} chars`
      : "Thinking…";

  const hasContent = input.trim().length > 0;
  const focusInput = () => textareaRef.current?.focus();

  return (
    <Box bg="transparent" pointerEvents="none">
      {loading ? (
        <Box px={1} pb={2} pointerEvents="auto">
          <ThinkingDots textColor={theme.text.muted} label={loadingLabel.toUpperCase()} />
        </Box>
      ) : null}

      {error ? (
        <Text fontSize="xs" color={theme.status.danger} px={1} pb={2} pointerEvents="auto">
          {error}
        </Text>
      ) : null}

      <Box
        ref={containerRef}
        onClick={focusInput}
        cursor="text"
        pointerEvents="auto"
        mx={2}
        mb={2}
        borderRadius="28px"
        border="1px solid"
        borderColor={isFocused ? theme.surface.focus : theme.border.primary}
        bg={theme.background.tertiary}
        boxShadow={isFocused ? theme.shadow.panelFocus : theme.shadow.panel}
        transition="border-color 0.2s ease, box-shadow 0.2s ease"
        display="flex"
        flexDirection="column"
        position="relative"
      >
        <Flex align="flex-start" position="relative">
          <AutoSizingTextarea
            ref={textareaRef}
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Make 3 clips around 30s with the funniest moments"
            bg="transparent"
            border="none"
            outline="none"
            _focus={{ boxShadow: "none", outline: "none" }}
            _focusVisible={{ boxShadow: "none", outline: "none" }}
            color={theme.text.primary}
            fontSize="14px"
            fontWeight="500"
            lineHeight="1.5"
            letterSpacing="-0.01em"
            flex={1}
            w="100%"
            pl={5}
            pr={5}
            py={3.5}
            resize="none"
            overflow="hidden"
            minRows={2}
            maxRows={8}
            h="auto"
            minH="unset"
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            _placeholder={{
              color: theme.text.muted,
              opacity: 0.7,
            }}
          />
        </Flex>

        <Flex justify="space-between" align="center" px={3} pb={2.5} pt={0.5} gap={2}>
          <HStack
            pl={0.5}
            align="center"
            gap={2}
            flex={1}
            minW={0}
            flexWrap="nowrap"
            overflow="hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <Box flexShrink={0}>
              <ClipperAiModelSelector model={model} onChange={onModelChange} />
            </Box>
            <ClipperAiChatPanelToggle
              value={panelView}
              onChange={onPanelViewChange}
              disabled={loading}
            />
            {onClearContext ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                h="24px"
                minH="24px"
                px={2}
                fontSize="10px"
                fontWeight="700"
                letterSpacing="-0.01em"
                color={theme.text.muted}
                borderRadius="lg"
                flexShrink={0}
                disabled={loading || messages.length === 0}
                _hover={{ bg: theme.surface.active, color: theme.text.primary }}
                onClick={(e) => {
                  e.stopPropagation();
                  onClearContext();
                }}
              >
                Clear context
              </Button>
            ) : null}
            {rangeWords.length > 0 ? (
              <Text
                fontSize="10px"
                fontWeight="600"
                letterSpacing="-0.01em"
                color={
                  contextUsage.percent >= 90
                    ? theme.status.danger
                    : contextUsage.percent >= 75
                      ? clipperTheme.accentLight
                      : theme.text.muted
                }
                flexShrink={0}
                userSelect="none"
                title={`~${contextUsage.tokens.toLocaleString()} / ${contextUsage.budget.toLocaleString()} tokens`}
              >
                {contextUsage.label}
              </Text>
            ) : null}
          </HStack>

          <Flex gap={2} align="center" flexShrink={0}>
            <Button
              aria-label="Send message"
              size="xs"
              variant="solid"
              onClick={(e) => {
                e.stopPropagation();
                handleSend();
              }}
              loading={loading}
              disabled={!hasContent}
              cursor="pointer"
              bg={hasContent ? accent : theme.background.secondary}
              color={hasContent ? "white" : theme.text.disabled}
              _hover={{
                bg: hasContent ? accent : theme.background.secondary,
                filter: hasContent ? "brightness(1.1)" : "none",
                transform: hasContent ? "scale(1.05)" : "none",
              }}
              transition="all 0.2s"
              borderRadius="full"
              w="30px"
              h="30px"
              minW="0"
              p={0}
            >
              <ArrowRight size={16} strokeWidth={2.5} />
            </Button>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
};
