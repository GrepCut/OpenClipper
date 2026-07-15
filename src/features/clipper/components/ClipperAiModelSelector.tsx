import React from "react";
import {
  HStack,
  Text,
  createListCollection,
  Select,
  Portal,
  Box,
  Icon,
  Span,
} from "@chakra-ui/react";
import { Brain, Zap } from "lucide-react";
import { FiChevronUp } from "react-icons/fi";
import type { ClipperAiClipPickerModel } from "../persistence/ai-clip-api";
import { useTheme } from "../../../theme";

const MODEL_OPTIONS: Array<{
  value: ClipperAiClipPickerModel;
  label: string;
  deepseekThinking?: "enabled" | "disabled";
}> = [
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash", deepseekThinking: "disabled" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", deepseekThinking: "disabled" },
  { value: "deepseek-v4-pro-thinking", label: "DeepSeek V4 Pro", deepseekThinking: "enabled" },
];

const truncateName = (name: string, max = 25) => {
  if (name.length <= max) return name;
  return `${name.slice(0, max)}...`;
};

function DeepSeekThinkingIcon({
  mode,
  isSelected = false,
  mutedColor,
  selectedColor,
}: {
  mode: "enabled" | "disabled";
  isSelected?: boolean;
  mutedColor: string;
  selectedColor: string;
}) {
  const isReasoning = mode === "enabled";
  const color = isSelected ? selectedColor : mutedColor;

  return (
    <Icon
      as={isReasoning ? Brain : Zap}
      boxSize="11px"
      color={color}
      opacity={isSelected ? 1 : 0.9}
      aria-label={isReasoning ? "Reasoning" : "Direct"}
    />
  );
}

interface ClipperAiModelSelectorProps {
  model: ClipperAiClipPickerModel;
  onChange: (model: ClipperAiClipPickerModel) => void;
}

export const ClipperAiModelSelector: React.FC<ClipperAiModelSelectorProps> = ({
  model,
  onChange,
}) => {
  const { theme } = useTheme();
  const collection = createListCollection({ items: MODEL_OPTIONS });
  const selectedModel = MODEL_OPTIONS.find((item) => item.value === model);

  return (
    <Select.Root
      collection={collection}
      value={[model]}
      onValueChange={(e) => {
        const next = e.value[0] as ClipperAiClipPickerModel | undefined;
        if (next) onChange(next);
      }}
      size="sm"
      positioning={{
        placement: "top-start",
        offset: { mainAxis: 12 },
      }}
    >
      <Select.Trigger
        bg="transparent"
        border="none"
        px={2}
        py={1}
        height="auto"
        minH="24px"
        display="flex"
        alignItems="center"
        gap={0.5}
        cursor="pointer"
        borderRadius="8px"
        color={theme.text.muted}
        transition="background 0.15s ease, color 0.15s ease"
        outline="none"
        _hover={{
          bg: theme.surface.hover,
          color: theme.text.primary,
        }}
        _active={{
          bg: theme.surface.muted,
        }}
      >
        <HStack gap={1} alignItems="center" flex={1} minW={0}>
          <Text
            fontSize="10px"
            fontWeight="700"
            color="inherit"
            letterSpacing="0.02em"
            userSelect="none"
            truncate
          >
            {selectedModel ? truncateName(selectedModel.label) : "Select model"}
          </Text>
          {selectedModel?.deepseekThinking ? (
            <DeepSeekThinkingIcon
              mode={selectedModel.deepseekThinking}
              mutedColor={theme.text.muted}
              selectedColor={theme.text.onBrand}
            />
          ) : null}
        </HStack>
        <Icon as={FiChevronUp} boxSize="10px" color="currentColor" opacity={0.7} />
      </Select.Trigger>

      <Portal>
        <Select.Positioner zIndex={30000}>
          <Select.Content
            className="intelligent-scrollbar"
            style={{
              background: theme.background.secondary,
              backdropFilter: "blur(20px) saturate(160%)",
              border: `1px solid ${theme.border.primary}`,
              borderRadius: "18px",
              boxShadow: theme.shadow.dropdown,
              padding: "8px",
              width: "max-content",
              minWidth: "200px",
              maxHeight: "320px",
              overflowY: "auto",
            }}
          >
            <Box px={2.5} py={1} mb={0.5}>
              <Text
                fontSize="9px"
                fontWeight="800"
                color={theme.text.muted}
                letterSpacing="1.2px"
                textTransform="uppercase"
              >
                Select model
              </Text>
            </Box>
            {collection.items.map((item) => {
              const isSelected = item.value === model;
              return (
                <Select.Item
                  key={item.value}
                  item={item}
                  px="12px"
                  py="9px"
                  borderRadius="12px"
                  cursor="pointer"
                  fontSize="12px"
                  color={isSelected ? "white" : theme.text.primary}
                  fontWeight={isSelected ? "600" : "500"}
                  bg={isSelected ? theme.brand.purple : "transparent"}
                  transition="background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease"
                  mb="2px"
                  display="flex"
                  alignItems="center"
                  gap="8px"
                  minW="200px"
                  boxShadow={isSelected ? `0 3px 12px ${theme.brand.purple}55` : "none"}
                  _hover={{
                    bg: isSelected ? theme.brand.purple : theme.surface.active,
                    color: "white",
                  }}
                >
                  <Select.ItemText flex="1" minW={0}>
                    <HStack gap={2} w="full" justify="space-between" align="center">
                      <Span truncate fontWeight="inherit">
                        {truncateName(item.label, 28)}
                      </Span>
                      {item.deepseekThinking ? (
                        <DeepSeekThinkingIcon
                          mode={item.deepseekThinking}
                          isSelected={isSelected}
                          mutedColor={theme.text.muted}
                          selectedColor={theme.text.onBrand}
                        />
                      ) : null}
                    </HStack>
                  </Select.ItemText>
                </Select.Item>
              );
            })}
          </Select.Content>
        </Select.Positioner>
      </Portal>
      <Select.HiddenSelect />
    </Select.Root>
  );
};
