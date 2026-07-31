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
}

interface ThemedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  width?: string;
}

export const ThemedSelect: React.FC<ThemedSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Unassigned",
  disabled = false,
  width = "full",
}) => {
  const { theme } = useTheme();
  const collection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );
  const selectedOption = options.find((option) => option.value === value);
  const displayLabel = selectedOption?.label ?? placeholder;

  return (
    <Select.Root
      collection={collection}
      value={[value]}
      onValueChange={(details) => {
        onChange(details.value[0] ?? "");
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
        <Select.Positioner zIndex={30000}>
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
          >
            {collection.items.map((item) => {
              const isSelected = item.value === value;
              return (
                <Select.Item
                  key={item.value || "__empty__"}
                  item={item}
                  px={3}
                  py={2}
                  borderRadius="lg"
                  cursor="pointer"
                  fontSize="sm"
                  color={theme.text.primary}
                  fontWeight={isSelected ? "semibold" : "normal"}
                  bg={isSelected ? theme.surface.active : "transparent"}
                  borderWidth={isSelected ? "1px" : "0"}
                  borderColor={isSelected ? theme.border.primary : "transparent"}
                  mb={1}
                  _hover={{
                    bg: theme.surface.active,
                  }}
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
