import { useCallback, useMemo } from "react";
import { isTauri } from "../utils/platform.util";
import { startDragging, toggleMaximize } from "../utils/tauri-window.util";

const DEFAULT_TITLEBAR_EXCLUDE_SELECTORS = [
  "button",
  "[data-titlebar-btn]",
  "[role='menuitem']",
  "[role='menu']",
  "[data-scope='menu']",
  "[data-part='content']",
] as const;

interface UseTauriTitleBarHandlersOptions {
  disabled?: boolean;
  excludeSelectors?: string[];
}

const shouldSkipTitleBarAction = (
  target: HTMLElement,
  excludeSelectors: readonly string[],
): boolean => excludeSelectors.some((selector) => target.closest(selector));

export const useTauriTitleBarHandlers = ({
  disabled = false,
  excludeSelectors = [],
}: UseTauriTitleBarHandlersOptions = {}) => {
  const allExcludeSelectors = useMemo(
    () => [...DEFAULT_TITLEBAR_EXCLUDE_SELECTORS, ...excludeSelectors],
    [excludeSelectors],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isTauri() || disabled) return;
      const target = e.target as HTMLElement;
      if (shouldSkipTitleBarAction(target, allExcludeSelectors)) return;
      startDragging().catch(() => {});
    },
    [allExcludeSelectors, disabled],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isTauri() || disabled) return;
      const target = e.target as HTMLElement;
      if (shouldSkipTitleBarAction(target, allExcludeSelectors)) return;
      toggleMaximize().catch(() => {});
    },
    [allExcludeSelectors, disabled],
  );

  const style = useMemo(
    () => ({
      userSelect: isTauri() ? ("none" as const) : ("auto" as const),
      WebkitUserSelect: isTauri() ? ("none" as const) : ("auto" as const),
    }),
    [],
  );

  // Natywny drag WebView2 (app-region: drag) — patrz src/shared/styles/app-drag-region.css.
  // Działa niezależnie od obciążenia wątku JS; handlery wyżej zostają jako fallback.
  const className = isTauri() && !disabled ? "app-drag-region" : undefined;

  return { onMouseDown, onDoubleClick, style, className };
};
