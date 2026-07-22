import { OUTLINED_ACTION_BUTTON_SIZE_PROPS } from "../../../../shared/components/buttons/outlined-action-button.component";
import type { ClipSourceMode } from "../../shared/state.util";

export const CLIP_SOURCE_MODE_OPTIONS: Array<{ value: ClipSourceMode; label: string }> = [
  { value: "auto-parts", label: "Auto-parts" },
  { value: "ai", label: "Generate with LLM" },
];

export const TOOLBAR_ACTION_BUTTON_PROPS = {
  ...OUTLINED_ACTION_BUTTON_SIZE_PROPS,
  h: "36px",
  minH: "36px",
  whiteSpace: "nowrap" as const,
};
