import { resolveCaptionPreset } from "../../lib/captions/caption-presets.util";
import type { CaptionGroup } from "../../lib/media/transcription-export.util";
import type { ClipperCaptionSettings } from "../../settings/settings.util";
import type { FrameEffectSize } from "../../lib/media/video-frame-effect.util";

function assEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function hexToAssColor(hex: string, alpha = 0): string {
  const cleaned = hex.replace("#", "").trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned.padStart(6, "0").slice(0, 6);
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  const a = Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, "0");
  // ASS uses &HAABBGGRR
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function formatAssTime(seconds: number): string {
  const msTotal = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(msTotal / 360000);
  const m = Math.floor((msTotal % 360000) / 6000);
  const s = Math.floor((msTotal % 6000) / 100);
  const cs = msTotal % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Builds a simplified ASS subtitle document approximating canvas caption burn-in.
 * Not pixel-identical to animated Canvas presets — close enough for social export.
 */
export function buildClipperAssCaptions(
  groups: CaptionGroup[],
  output: FrameEffectSize,
  captions: ClipperCaptionSettings,
): string {
  if (!captions.enabled || groups.length === 0) return "";

  const preset = resolveCaptionPreset(captions.presetId);
  const fontSizeScale = { small: 0.8, medium: 1, large: 1.24 }[captions.size];
  const anchorY = { top: 0.22, center: 0.5, bottom: 0.78 }[captions.position];
  const fontSize = Math.max(18, Math.round(output.height * preset.fontSizeRatio * fontSizeScale));
  const marginV = Math.max(24, Math.round(output.height * (1 - anchorY) - fontSize));
  const outline = Math.max(0, Math.round(fontSize * (preset.outlineWidthEm || 0.08)));
  const shadow = Math.max(0, Math.round(fontSize * (preset.shadowBlurEm || 0) * 0.25));
  const primary = hexToAssColor(preset.textColor || "#FFFFFF");
  const outlineColor = hexToAssColor(preset.outlineColor || "#000000");
  const backColor = hexToAssColor(preset.shadowColor || "#000000", 128);
  const fontName = preset.fontFamily || "Arial";
  const bold = preset.fontWeight >= 700 ? -1 : 0;
  const italic = preset.fontStyle === "italic" ? -1 : 0;
  const upper = preset.uppercase;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${output.width}
PlayResY: ${output.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primary},${primary},${outlineColor},${backColor},${bold},${italic},0,0,100,100,0,0,1,${outline},${shadow},2,48,48,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = groups
    .map((group) => {
      const text = group.words.map((w) => w.text).join(" ");
      const body = assEscape(upper ? text.toUpperCase() : text);
      if (!body.trim()) return null;
      const start = formatAssTime(group.start);
      const end = formatAssTime(Math.max(group.start + 0.05, group.end));
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${body}`;
    })
    .filter(Boolean)
    .join("\n");

  return `${header}${events}\n`;
}
