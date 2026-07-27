/** Accent palette tokens shared by clipper UI components. */
export interface FeatureTheme {
  eyebrow: string;
  accent: string;
  accentHover: string;
  accentLight: string;
  accentGlow: string;
  accentSoftBg: string;
  accentTintRgb: string;
  gradientFrom: string;
  gradientTo: string;
  presetSelectedBg: string;
  presetSelectedChip: string;
  settingSelectedBg: string;
  settingSelectedBorder: string;
  checkboxBg: string;
  checkboxBorder: string;
  contentLink: string;
  contentAccent: string;
  ctaTintRgb: string;
  cardAccents: string[];
}

export const PURPLE_CARD_ACCENTS = [
  "#0056B3",
  "#007BFF",
  "#1E90FF",
  "#00C3FF",
  "#4DB8FF",
] as const;
