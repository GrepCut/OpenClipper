import type { FeatureTheme } from '../lib/theme/feature-theme';
import { PURPLE_CARD_ACCENTS } from '../lib/theme/feature-theme';
import { colors } from "../../../theme/colors";

const purple = colors.purple;
const brand = colors.dark.brand;

/** Purple palette aligned with `client/src/theme` for the `/clipper` product surface. */
export const clipperTheme: FeatureTheme = {
  eyebrow: "/ clipper",
  accent: purple.medium,
  accentHover: "#8B5CF6",
  accentLight: brand.purpleSoft,
  accentGlow: "#A78BFA",
  accentSoftBg: purple.accent2,
  accentTintRgb: "118,84,224",
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
  ctaTintRgb: "118,84,224",
  cardAccents: [...PURPLE_CARD_ACCENTS],
};
