import { OUTLINED_ACTION_BUTTON_SIZE_PROPS } from "../../../../shared/components/buttons/outlined-action-button.component";
import type { ClipSourceMode } from "../../shared/state.util";

export const SIDE_PANEL_TAB_OPTIONS: Array<{ value: ClipSourceMode; label: string }> = [
  { value: "auto-parts", label: "Auto-parts" },
  { value: "ai", label: "MCP" },
  { value: "manual", label: "Manual" },
];

export const TOOLBAR_ACTION_BUTTON_PROPS = {
  ...OUTLINED_ACTION_BUTTON_SIZE_PROPS,
  h: "36px",
  minH: "36px",
  whiteSpace: "nowrap" as const,
};
