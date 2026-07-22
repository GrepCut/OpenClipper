export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
}

export type SubtitlePosition = "top" | "center" | "bottom";
export type SubtitleFontSize = "sm" | "md" | "lg" | "xl";
export type SubtitleFontFamily = "arial" | "system";
export type SubtitleWrap = "off" | "on";

export type SubtitleStyle = {
  position: SubtitlePosition;
  fontSize: SubtitleFontSize;
  fontFamily: SubtitleFontFamily;
  wrap: SubtitleWrap;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  position: "bottom",
  fontSize: "md",
  fontFamily: "arial",
  wrap: "off",
};

export function subtitleStyleFromSettings(
  settings?: Readonly<Record<string, string>>,
): SubtitleStyle {
  const position = settings?.position;
  const fontSize = settings?.fontSize;
  const fontFamily = settings?.fontFamily;
  const wrap = settings?.wrap;

  return {
    position:
      position === "top" || position === "center" || position === "bottom"
        ? position
        : DEFAULT_SUBTITLE_STYLE.position,
    fontSize:
      fontSize === "sm" || fontSize === "md" || fontSize === "lg" || fontSize === "xl"
        ? fontSize
        : DEFAULT_SUBTITLE_STYLE.fontSize,
    fontFamily:
      fontFamily === "arial" || fontFamily === "system"
        ? fontFamily
        : DEFAULT_SUBTITLE_STYLE.fontFamily,
    wrap: wrap === "on" || wrap === "off" ? wrap : DEFAULT_SUBTITLE_STYLE.wrap,
  };
}
