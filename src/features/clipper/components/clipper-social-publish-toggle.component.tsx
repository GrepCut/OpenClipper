import type { ComponentProps, ReactNode } from "react";
import {
  getOutlinedActionSurfaceProps,
  OutlinedActionButton,
  OUTLINED_ACTION_BUTTON_SIZE_PROPS,
} from "../../../shared/components/buttons/outlined-action-button.component";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

const TOGGLE_BUTTON_PROPS = {
  ...OUTLINED_ACTION_BUTTON_SIZE_PROPS,
  h: "36px",
  minH: "36px",
  whiteSpace: "nowrap" as const,
};

export function ToggleOptionButton({
  isSelected,
  disabled,
  onClick,
  children,
  ...buttonProps
}: {
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
} & ComponentProps<typeof OutlinedActionButton>) {
  const { theme } = useClipperUi();

  return (
    <OutlinedActionButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isSelected}
      borderRadius="xl"
      color={isSelected ? theme.text.primary : theme.text.muted}
      {...getOutlinedActionSurfaceProps(theme, isSelected)}
      {...TOGGLE_BUTTON_PROPS}
      {...buttonProps}
    >
      {children}
    </OutlinedActionButton>
  );
}
