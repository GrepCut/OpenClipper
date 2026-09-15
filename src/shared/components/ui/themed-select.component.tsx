import React, { useMemo } from "react";
import {
  Text,
  createListCollection,
  Select,
  Portal,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useTheme } from "../../../theme";

export interface ThemedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ThemedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  width?: string;
  /** Must beat StyledModal (9999); Chakra zIndex tokens are ignored on Positioner. */
  zIndex?: number;
}

export const ThemedSelect: React.FC<ThemedSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Unassigned",
  disabled = false,
  width = "full",
  zIndex = 40000,
}) => {
  const { theme } = useTheme();
  const collection = useMemo(
    () =>
      createListCollection({
        items: options,
        isItemDisabled: (item) => Boolean(item.disabled),
      }),
    [options],
  );
  const selectedOption = options.find((option) => option.value === value);
  const displayLabel = selectedOption?.label ?? placeholder;
  const selectedValues = selectedOption ? [value] : [];

  return (
    <Select.Root
      collection={collection}
      value={selectedValues}
      onValueChange={(details) => {
        const nextValue = details.value[0] ?? "";
        const nextOption = options.find((option) => option.value === nextValue);
        if (nextOption?.disabled) return;
        onChange(nextValue);
      }}
      size="sm"
      disabled={disabled}
      width={width}
    >
      <Select.Trigger
        w="full"
        bg={theme.background.surface}
        borderWidth="1px"
        borderStyle="solid"
        borderColor={theme.surface.hover}
        borderRadius="lg"
        color={theme.text.onBrandMuted}
        fontSize="sm"
        px={3}
        py={2}
        minH="36px"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        cursor={disabled ? "not-allowed" : "pointer"}
        opacity={disabled ? 0.6 : 1}
        _hover={disabled ? {} : { borderColor: theme.border.primary }}
        _focusVisible={{
          outline: "none",
          borderColor: theme.border.focus,
          boxShadow: `0 0 0 1px ${theme.border.focus}`,
        }}
      >
        <Text truncate fontSize="sm" color="inherit" flex={1} textAlign="left">
          {displayLabel}
        </Text>
        <ChevronDown size={16} color={theme.text.muted} />
      </Select.Trigger>

      <Portal>
        <Select.Positioner css={{ zIndex }} style={{ zIndex }}>
          <Select.Content
            className="intelligent-scrollbar"
            bg={theme.background.secondary}
            borderWidth="1px"
            borderColor={theme.border.primary}
            borderRadius="xl"
            boxShadow={theme.shadow.dropdown}
            p={2}
            minW="var(--reference-width)"
            maxH="280px"
            overflowY="auto"
            style={{ zIndex }}
          >
            {collection.items.map((item) => {
              const isSelected = item.value === value;
              const isDisabled = Boolean(item.disabled);
              return (
                <Select.Item
                  key={item.value || "__empty__"}
                  item={item}
                  px={3}
                  py={2}
                  borderRadius="lg"
                  cursor={isDisabled ? "not-allowed" : "pointer"}
                  fontSize="sm"
                  color={theme.text.primary}
                  fontWeight={isSelected ? "semibold" : "normal"}
                  bg={isSelected ? theme.surface.active : "transparent"}
                  borderWidth={isSelected ? "1px" : "0"}
                  borderColor={isSelected ? theme.border.primary : "transparent"}
                  opacity={isDisabled ? 0.5 : 1}
                  mb={1}
                  _hover={isDisabled ? {} : { bg: theme.surface.active }}
                  _last={{ mb: 0 }}
                >
                  <Select.ItemText>{item.label}</Select.ItemText>
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
