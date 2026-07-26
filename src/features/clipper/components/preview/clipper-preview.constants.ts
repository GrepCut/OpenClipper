import { OUTLINED_ACTION_BUTTON_SIZE_PROPS } from "../../../../shared/components/buttons/outlined-action-button.component";

export type SidePanelTab = "auto-parts" | "ai";

export const SIDE_PANEL_TAB_OPTIONS: Array<{ value: SidePanelTab; label: string }> = [
  { value: "auto-parts", label: "Auto-parts" },
  { value: "ai", label: "Generate with LLM" },
];

export const TOOLBAR_ACTION_BUTTON_PROPS = {
  ...OUTLINED_ACTION_BUTTON_SIZE_PROPS,
  h: "36px",
  minH: "36px",
  whiteSpace: "nowrap" as const,
};
