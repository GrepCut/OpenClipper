import type { FeatureTheme } from '../lib/theme/feature-theme.util';
import { PURPLE_CARD_ACCENTS } from '../lib/theme/feature-theme.util';
import { colors } from "../../../theme/colors.util";

const purple = colors.purple;
const brand = colors.dark.brand;

/** Blue palette aligned with clipper logo for the `/clipper` product surface. */
export const clipperTheme: FeatureTheme = {
  eyebrow: "/ clipper",
  accent: purple.medium,
  accentHover: "#00C3FF",
  accentLight: brand.purpleSoft,
  accentGlow: "#00C3FF",
  accentSoftBg: purple.accent2,
  accentTintRgb: "30,144,255",
  gradientFrom: purple.medium,
  gradientTo: purple.accent1,
  presetSelectedBg: purple.accent1,
  presetSelectedChip: purple.medium,
  settingSelectedBg: purple.royal,
  settingSelectedBorder: purple.medium,
  checkboxBg: purple.accent1,
  checkboxBorder: brand.purpleSoft,
  contentLink: brand.purpleSoft,
  contentAccent: purple.medium,
  ctaTintRgb: "30,144,255",
  cardAccents: [...PURPLE_CARD_ACCENTS],
};
