import React from "react";
import { Text, type TextProps } from "@chakra-ui/react";
import { useTheme } from "../../theme";

type ThemeTitleVariant = "secondary" | "specific";

const VARIANT_DEFAULTS: Record<
  ThemeTitleVariant,
  { fontSize: string; fontWeight?: string }
> = {
  secondary: { fontSize: "24px", fontWeight: "medium" },
  specific: { fontSize: "17px", fontWeight: "medium" },
};

interface ThemeTitleProps extends TextProps {
  variant?: ThemeTitleVariant;
}

export const ThemeTitle: React.FC<ThemeTitleProps> = ({
  variant = "specific",
  children,
  fontSize,
  fontWeight,
  ...props
}) => {
  const { theme } = useTheme();
  const defaults = VARIANT_DEFAULTS[variant];

  return (
    <Text
      fontSize={fontSize ?? defaults.fontSize}
      fontWeight={fontWeight ?? defaults.fontWeight}
      color={theme.text.primary}
      {...props}
    >
      {children}
    </Text>
  );
};
