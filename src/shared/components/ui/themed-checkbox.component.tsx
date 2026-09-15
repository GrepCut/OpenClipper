import type { ReactNode } from "react";
import { Checkbox, Text } from "@chakra-ui/react";
import { useTheme } from "../../../theme";

interface ThemedCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function ThemedCheckbox({
  checked,
  onCheckedChange,
  disabled = false,
  children,
}: ThemedCheckboxProps) {
  const { theme } = useTheme();

  return (
    <Checkbox.Root
      size="sm"
      checked={checked}
      disabled={disabled}
      onCheckedChange={(details) => onCheckedChange(details.checked === true)}
      display="flex"
      alignItems="flex-start"
      gap={2}
      p={1}
      overflow="visible"
      cursor={disabled ? "not-allowed" : "pointer"}
      opacity={disabled ? 0.6 : 1}
      outline="none"
      _focusVisible={{ outline: "none" }}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control
        mt="2px"
        w="16px"
        h="16px"
        flexShrink={0}
        overflow="visible"
        borderRadius="md"
        borderWidth="1px"
        borderColor={theme.surface.borderStrong}
        bg={theme.background.surface}
        color={theme.text.onBrand}
        outline="none"
        _checked={{
          bg: theme.brand.purple,
          borderColor: theme.brand.purple,
          color: theme.text.onBrand,
        }}
        _hover={disabled ? undefined : { borderColor: theme.border.primary }}
        _focusVisible={{
          outline: "none",
          boxShadow: `0 0 0 2px ${theme.border.focus}`,
        }}
      >
        <Checkbox.Indicator />
      </Checkbox.Control>
      <Checkbox.Label>
        <Text
          fontSize="sm"
          color={theme.text.primary}
          lineHeight="1.4"
          whiteSpace="normal"
        >
          {children}
        </Text>
      </Checkbox.Label>
    </Checkbox.Root>
  );
}
