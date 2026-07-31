import type { InputProps, TextareaProps } from "@chakra-ui/react";
import { Input, Textarea } from "@chakra-ui/react";
import { useTheme, type Theme } from "../../../theme";

export const getThemedInputProps = (theme: Theme) => ({
  size: "sm" as const,
  bg: theme.background.surface,
  borderWidth: "1px",
  borderStyle: "solid" as const,
  borderColor: theme.surface.hover,
  borderRadius: "2xl",
  color: theme.text.onBrandMuted,
  fontSize: "sm",
  _placeholder: { color: theme.text.muted },
  _hover: { borderColor: theme.border.primary },
  _focusVisible: {
    outline: "none",
    borderColor: theme.border.focus,
    boxShadow: `0 0 0 1px ${theme.border.focus}`,
  },
});

type ThemedInputProps = Omit<InputProps, "size">;
type ThemedTextareaProps = Omit<TextareaProps, "size">;

export function ThemedInput(props: ThemedInputProps) {
  const { theme } = useTheme();
  return <Input {...getThemedInputProps(theme)} {...props} />;
}

export function ThemedTextarea(props: ThemedTextareaProps) {
  const { theme } = useTheme();
  return <Textarea {...getThemedInputProps(theme)} {...props} />;
}
