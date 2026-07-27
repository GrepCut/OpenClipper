import { useMemo } from "react";
import { useTheme } from "../../../theme";
import type { Theme } from "../../../theme";
import { clipperTheme } from "./theme.util";

function getClipperScrollbarCss(theme: Theme) {
  return {
    scrollbarWidth: "thin" as const,
    scrollbarColor: `${theme.scrollbar.thumb} ${theme.scrollbar.track}`,
    "&::-webkit-scrollbar": { width: "8px", height: "8px" },
    "&::-webkit-scrollbar-track": { background: theme.scrollbar.track },
    "&::-webkit-scrollbar-thumb": {
      background: theme.scrollbar.thumb,
      borderRadius: "4px",
    },
    "&::-webkit-scrollbar-thumb:hover": {
      background: theme.brand.purpleLight,
    },
  };
}

function getClipperLeftScrollbarCss(theme: Theme) {
  return {
    ...getClipperScrollbarCss(theme),
    direction: "rtl" as const,
    overflowY: "auto" as const,
    overscrollBehavior: "contain" as const,
  };
}

function getClipperHiddenScrollbarCss() {
  return {
    scrollbarWidth: "none" as const,
    msOverflowStyle: "none" as const,
    "&::-webkit-scrollbar": { display: "none" },
  };
}

/** Shared outline button props used across Clipper action surfaces. */
function clipperOutlineButtonProps(theme: Theme) {
  return {
    color: theme.brand.purpleText,
    borderColor: theme.surface.elevated,
    _hover: {
      bg: `rgba(${clipperTheme.accentTintRgb},0.14)`,
      borderColor: clipperTheme.accentGlow,
    },
  } as const;
}

/** Error callout panel (failed load, pipeline error). */
function clipperErrorPanelProps(theme: Theme) {
  return {
    border: "1px solid",
    borderColor: theme.status.danger,
    bg: theme.interactive.destructiveHover,
  } as const;
}

export function useClipperUi() {
  const { theme, mode } = useTheme();

  const scrollbarCss = useMemo(() => getClipperScrollbarCss(theme), [theme]);
  const leftScrollbarCss = useMemo(() => getClipperLeftScrollbarCss(theme), [theme]);
  const hiddenScrollbarCss = useMemo(() => getClipperHiddenScrollbarCss(), []);

  return {
    theme,
    mode,
    panelShadow: theme.shadow.panelFocus,
    scrollbarCss,
    leftScrollbarCss,
    hiddenScrollbarCss,
    outlineButton: clipperOutlineButtonProps(theme),
    errorPanel: clipperErrorPanelProps(theme),
  };
}
