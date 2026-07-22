import { produce, type Draft } from "immer";

import type { ClipperPipelineState } from "../../shared/state.util";

export function patchPipelineState(
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>,
  recipe: (draft: Draft<ClipperPipelineState>) => void,
): void {
  setState((prev) => produce(prev, recipe));
}
