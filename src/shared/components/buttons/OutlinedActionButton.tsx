import type { ButtonProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useTheme, type Theme } from "../../../theme";
import { MainButton } from "./main-button";

export const OUTLINED_ACTION_BUTTON_SIZE_PROPS = {
  h: "36px",
  fontSize: "sm",
  px: 4,
} as const;

export const getOutlinedActionSurfaceProps = (theme: Theme, isSelected = false) => ({
  bg: isSelected ? theme.background.secondary : theme.background.tertiary,
  borderWidth: "1px",
  borderStyle: "solid" as const,
  borderColor: isSelected ? theme.border.primary : theme.border.secondary,
  transition: "all 0.2s",
  _hover: {
    bg: theme.background.secondary,
    borderColor: theme.border.primary,
  },
});

interface OutlinedActionButtonProps extends ButtonProps {
  children: ReactNode;
  startIcon?: ReactNode;
}

export const OutlinedActionButton = ({
  children,
  startIcon,
  ...props
}: OutlinedActionButtonProps) => {
  const { theme } = useTheme();
  const surfaceProps = getOutlinedActionSurfaceProps(theme);

  return (
    <MainButton
      display="inline-flex"
      alignItems="center"
      gap={2}
      color={theme.text.primary}
      fontWeight="medium"
      {...surfaceProps}
      _hover={{
        ...surfaceProps._hover,
        filter: "none",
        transform: "none",
      }}
      {...OUTLINED_ACTION_BUTTON_SIZE_PROPS}
      {...props}
    >
      {startIcon}
      {children}
    </MainButton>
  );
};
