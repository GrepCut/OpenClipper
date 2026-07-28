export const CLIPPER_CAPTION_PRESET_IDS = [
  "capicola-box",
  "capicola-color",
  "capicola-bubble",
  "capicola-plain",
  "beast",
  "karaoke",
  "grape",
  "soft-ai",
  "gaming-stream",
  "simple-one-word",
  "pop",
  "hustle",
  "poppin",
  "aarit",
  "kinetic-01",
  "kinetic-02",
  "podcast",
  "lime-box",
  "cyan-punch",
  "light-bubble",
] as const;

export type ClipperCaptionPresetId =
  (typeof CLIPPER_CAPTION_PRESET_IDS)[number];

export type CaptionFontFamily =
  | "Barlow Condensed"
  | "Anton"
  | "Dancing Script"
  | "Inter"
  | "Montserrat"
  | "Outfit"
  | "Poppins"
  | "Rajdhani";
export type CaptionPlateStyle = "none" | "group";
export type CaptionRendererKind =
  "phrase" | "karaoke" | "one-word" | "kinetic" | "podcast";
export type CaptionActiveEffect =
  | "none"
  | "color"
  | "gradient-pill"
  | "glow"
  | "beast-pop"
  | "pop"
  | "hustle"
  | "longest-color";
export type CaptionEntrance =
  | "none"
  | "page-fade"
  | "group-fade"
  | "word-blur"
  | "word-scale"
  | "word-rise";

export interface CaptionGradient {
  from: string;
  to: string;
}

export interface CaptionPresetDefinition {
  id: ClipperCaptionPresetId;
  label: string;
  description: string;
  renderer: CaptionRendererKind;
  wordsPerGroup: number;
  fontFamily: CaptionFontFamily;
  fontWeight: 400 | 600 | 700 | 800 | 900;
  fontStyle: "normal" | "italic";
  fontSizeRatio: number;
  lineHeightRatio: number;
  letterSpacingEm: number;
  wordGapEm: number;
  uppercase: boolean;
  anchorY: number;
  maxWidthRatio: number;
  textColor: string;
  activeColor: string;
  activeTextColor: string;
  outlineColor: string;
  outlineWidthEm: number;
  shadowColor: string;
  shadowBlurEm: number;
  shadowOffsetXEm: number;
  shadowOffsetYEm: number;
  plateStyle: CaptionPlateStyle;
  plateColor: string;
  plateOpacity: number;
  plateRadiusEm: number;
  platePaddingXEm: number;
  platePaddingYEm: number;
  activeEffect: CaptionActiveEffect;
  activeGradient?: CaptionGradient;
  activePaddingXEm: number;
  activePaddingYEm: number;
  activeRadiusEm: number;
  activeTransitionSec: number;
  activeScale: number;
  activeRotationDeg: number;
  entrance: CaptionEntrance;
  entranceDurationSec: number;
  entranceScaleFrom: number;
  entranceBlurEm: number;
  inactiveOpacity?: number;
  activeOutlineWidthEm?: number;
  groupScaleTo?: number;
  secondaryFontFamily?: CaptionFontFamily;
  secondaryFontSizeScale?: number;
  differenceBlend?: boolean;
  accentColors?: readonly string[];
}

export const DEFAULT_CAPTION_PRESET_ID: ClipperCaptionPresetId = "capicola-box";
export const CAPTION_SAMPLE_WORDS = [
  "Zażółć",
  "gęślą",
  "jaźń,",
  "twórz",
  "wyjątkową",
  "chwilę.",
] as const;

const SHARED_CAPTION_LAYOUT = {
  wordsPerGroup: 4,
  lineHeightRatio: 1.2,
  anchorY: 0.78,
  maxWidthRatio: 0.84,
} as const;

const SHARED_NO_PLATE = {
  plateStyle: "none",
  plateColor: "#000000",
  plateOpacity: 0,
  plateRadiusEm: 0,
  platePaddingXEm: 0,
  platePaddingYEm: 0,
} as const;

const SHARED_NO_ACTIVE_BOX = {
  activePaddingXEm: 0,
  activePaddingYEm: 0,
  activeRadiusEm: 0,
} as const;

const SHARED_NO_TRANSFORM = {
  activeScale: 1,
  activeRotationDeg: 0,
} as const;

const SHARED_SUBTLE_DARK_OUTLINE = {
  outlineColor: "#050505",
  outlineWidthEm: 0.06,
} as const;

const SHARED_NO_ENTRANCE = {
  entrance: "none",
  entranceDurationSec: 0,
  entranceScaleFrom: 1,
  entranceBlurEm: 0,
} as const;

const CAPTION_PRESET_DEFINITIONS: Record<
  ClipperCaptionPresetId,
  CaptionPresetDefinition
> = {
  "capicola-box": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_TRANSFORM,
    id: "capicola-box",
    label: "Box",
    description:
      "Condensed caps with Capicola's signature pink active-word box",
    renderer: "phrase",
    fontFamily: "Barlow Condensed",
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.072,
    letterSpacingEm: 0.02,
    wordGapEm: 0.5,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#D51E58",
    activeTextColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidthEm: 0.1,
    shadowColor: "rgba(0,0,0,0.55)",
    shadowBlurEm: 0.16,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.13,
    activeEffect: "gradient-pill",
    activeGradient: { from: "#E62E64", to: "#C4124C" },
    activePaddingXEm: 0.27,
    activePaddingYEm: 0.1,
    activeRadiusEm: 0.27,
    activeTransitionSec: 0.15,
    entrance: "page-fade",
    entranceDurationSec: 0.15,
    entranceScaleFrom: 1,
    entranceBlurEm: 0,
  },
  "capicola-color": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    id: "capicola-color",
    label: "Color",
    description: "Heavy outlined type with a clean gold word highlight",
    renderer: "phrase",
    fontFamily: "Inter",
    fontWeight: 800,
    fontStyle: "normal",
    fontSizeRatio: 0.068,
    letterSpacingEm: 0,
    wordGapEm: 0.3,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFC53D",
    activeTextColor: "#FFC53D",
    outlineColor: "#000000",
    outlineWidthEm: 0.11,
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurEm: 0.12,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.1,
    activeEffect: "color",
    activeTransitionSec: 0.12,
    entrance: "page-fade",
    entranceDurationSec: 0.15,
    entranceScaleFrom: 1,
    entranceBlurEm: 0,
  },
  "capicola-bubble": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_NO_ENTRANCE,
    id: "capicola-bubble",
    label: "Bubble",
    description: "Calm subtitle-sized type on a translucent rounded bubble",
    renderer: "phrase",
    fontFamily: "Inter",
    fontWeight: 600,
    fontStyle: "normal",
    fontSizeRatio: 0.052,
    letterSpacingEm: 0,
    wordGapEm: 0.26,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFFFFF",
    activeTextColor: "#FFFFFF",
    outlineColor: "transparent",
    outlineWidthEm: 0,
    shadowColor: "transparent",
    shadowBlurEm: 0,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0,
    plateStyle: "group",
    plateColor: "#000000",
    plateOpacity: 0.6,
    plateRadiusEm: 0.38,
    platePaddingXEm: 0.67,
    platePaddingYEm: 0.29,
    activeEffect: "none",
    activeTransitionSec: 0,
  },
  "capicola-plain": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    id: "capicola-plain",
    label: "Plain",
    description: "Bold high-contrast type with no moving word highlight",
    renderer: "phrase",
    fontFamily: "Inter",
    fontWeight: 800,
    fontStyle: "normal",
    fontSizeRatio: 0.068,
    letterSpacingEm: 0,
    wordGapEm: 0.3,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFFFFF",
    activeTextColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidthEm: 0.11,
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurEm: 0.12,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.1,
    activeEffect: "none",
    activeTransitionSec: 0,
    entrance: "page-fade",
    entranceDurationSec: 0.15,
    entranceScaleFrom: 1,
    entranceBlurEm: 0,
  },
  beast: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_ENTRANCE,
    id: "beast",
    label: "Beast",
    description: "Comic impact type with a springy yellow active word",
    renderer: "phrase",
    fontFamily: "Montserrat",
    fontWeight: 900,
    fontStyle: "italic",
    fontSizeRatio: 0.075,
    letterSpacingEm: -0.02,
    wordGapEm: 0.26,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FFFF00",
    activeTextColor: "#FFFF00",
    outlineColor: "#000000",
    outlineWidthEm: 0.17,
    shadowColor: "#000000",
    shadowBlurEm: 0,
    shadowOffsetXEm: 0.09,
    shadowOffsetYEm: 0.09,
    activeEffect: "beast-pop",
    activeTransitionSec: 0.28,
    activeScale: 1.15,
    activeRotationDeg: -2,
  },
  karaoke: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_NO_ENTRANCE,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "karaoke",
    label: "Karaoke",
    description: "A smooth left-to-right gold sweep tied to each spoken word",
    renderer: "karaoke",
    fontFamily: "Outfit",
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.066,
    letterSpacingEm: 0,
    wordGapEm: 0.34,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurEm: 0.14,
    shadowOffsetXEm: 0.03,
    shadowOffsetYEm: 0.05,
    activeEffect: "none",
    activeTransitionSec: 0,
  },
  grape: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    id: "grape",
    label: "Grape",
    description: "Heavy italic caps on a polished purple caption plate",
    renderer: "phrase",
    fontFamily: "Outfit",
    fontWeight: 900,
    fontStyle: "italic",
    fontSizeRatio: 0.064,
    letterSpacingEm: 0,
    wordGapEm: 0.28,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FFD166",
    activeTextColor: "#FFD166",
    outlineColor: "transparent",
    outlineWidthEm: 0,
    shadowColor: "rgba(0,0,0,0.3)",
    shadowBlurEm: 0.18,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.08,
    plateStyle: "group",
    plateColor: "#6D28D9",
    plateOpacity: 0.96,
    plateRadiusEm: 0.22,
    platePaddingXEm: 0.5,
    platePaddingYEm: 0.22,
    activeEffect: "color",
    activeTransitionSec: 0.1,
    entrance: "group-fade",
    entranceDurationSec: 1,
    entranceScaleFrom: 1,
    entranceBlurEm: 0,
  },
  "soft-ai": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "soft-ai",
    label: "Soft AI",
    description: "Soft modern type revealing word by word through blur",
    renderer: "phrase",
    fontFamily: "Outfit",
    fontWeight: 800,
    fontStyle: "normal",
    fontSizeRatio: 0.064,
    letterSpacingEm: -0.03,
    wordGapEm: 0.26,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    outlineWidthEm: 0.05,
    shadowColor: "rgba(0,0,0,0.35)",
    shadowBlurEm: 0.33,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.11,
    activeEffect: "color",
    activeTransitionSec: 0.15,
    activeScale: 1,
    activeRotationDeg: 0,
    entrance: "word-blur",
    entranceDurationSec: 0.4,
    entranceScaleFrom: 1,
    entranceBlurEm: 0.35,
  },
  "gaming-stream": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "gaming-stream",
    label: "Gaming Stream",
    description: "Condensed neon typography with a cyan active-word glow",
    renderer: "phrase",
    fontFamily: "Rajdhani",
    fontWeight: 700,
    fontStyle: "normal",
    fontSizeRatio: 0.068,
    letterSpacingEm: 0,
    wordGapEm: 0.24,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#00E5FF",
    activeTextColor: "#00E5FF",
    outlineWidthEm: 0.055,
    shadowColor: "transparent",
    shadowBlurEm: 0,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0,
    activeEffect: "glow",
    activeTransitionSec: 0.1,
    entrance: "word-scale",
    entranceDurationSec: 0.27,
    entranceScaleFrom: 0.5,
    entranceBlurEm: 0,
  },
  "simple-one-word": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_NO_ENTRANCE,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "simple-one-word",
    label: "Simple One Word",
    description: "One clean focal word at a time",
    renderer: "one-word",
    wordsPerGroup: 1,
    fontFamily: "Outfit",
    fontWeight: 800,
    fontStyle: "normal",
    fontSizeRatio: 0.085,
    letterSpacingEm: 0,
    wordGapEm: 0,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FFFFFF",
    activeTextColor: "#FFFFFF",
    shadowColor: "rgba(0,0,0,0.35)",
    shadowBlurEm: 0.12,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.06,
    activeEffect: "none",
    activeTransitionSec: 0,
  },
  pop: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_ENTRANCE,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "pop",
    label: "Pop",
    description: "Clean Outfit typography with a bouncy active-word punch",
    renderer: "phrase",
    fontFamily: "Outfit",
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.07,
    letterSpacingEm: 0,
    wordGapEm: 0.34,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurEm: 0.14,
    shadowOffsetXEm: 0.03,
    shadowOffsetYEm: 0.05,
    activeEffect: "pop",
    activeTransitionSec: 0.28,
    activeScale: 1.2,
    activeRotationDeg: 0,
    inactiveOpacity: 0.78,
  },
  hustle: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_NO_ENTRANCE,
    id: "hustle",
    label: "Hustle",
    description: "Fast italic caps whose active word cuts through the outline",
    renderer: "phrase",
    fontFamily: "Montserrat",
    fontWeight: 900,
    fontStyle: "italic",
    fontSizeRatio: 0.072,
    letterSpacingEm: -0.02,
    wordGapEm: 0.26,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    outlineColor: "#000000",
    outlineWidthEm: 0.17,
    shadowColor: "rgba(0,0,0,0.35)",
    shadowBlurEm: 0.06,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.06,
    activeEffect: "hustle",
    activeTransitionSec: 0.1,
    activeOutlineWidthEm: 0.055,
  },
  poppin: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_NO_ENTRANCE,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "poppin",
    label: "Poppin",
    description: "Vibrant Poppins caps with a deep social-video shadow",
    renderer: "phrase",
    fontFamily: "Poppins",
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.07,
    letterSpacingEm: 0,
    wordGapEm: 0.26,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurEm: 0.24,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.12,
    activeEffect: "color",
    activeTransitionSec: 0.1,
  },
  aarit: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "aarit",
    label: "Aarit",
    description: "Cinematic rising words with emphasis on the strongest term",
    renderer: "phrase",
    fontFamily: "Poppins",
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.064,
    letterSpacingEm: -0.02,
    wordGapEm: 0.34,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    outlineWidthEm: 0.065,
    shadowColor: "rgba(0,0,0,0.8)",
    shadowBlurEm: 0.11,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.06,
    activeEffect: "longest-color",
    activeTransitionSec: 0,
    entrance: "word-rise",
    entranceDurationSec: 0.33,
    entranceScaleFrom: 1.22,
    entranceBlurEm: 0,
    groupScaleTo: 1.15,
  },
  "kinetic-01": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "kinetic-01",
    label: "Kinetic 01",
    description: "A large anchor word surrounded by handwritten side words",
    renderer: "kinetic",
    fontFamily: "Montserrat",
    secondaryFontFamily: "Dancing Script",
    secondaryFontSizeScale: 0.52,
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.082,
    letterSpacingEm: -0.02,
    wordGapEm: 0.12,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    outlineWidthEm: 0.055,
    shadowColor: "rgba(0,0,0,0.6)",
    shadowBlurEm: 0.18,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.08,
    activeEffect: "color",
    activeTransitionSec: 0.1,
    entrance: "word-rise",
    entranceDurationSec: 0.3,
    entranceScaleFrom: 0.85,
    entranceBlurEm: 0,
    differenceBlend: false,
  },
  "kinetic-02": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "kinetic-02",
    label: "Kinetic 02",
    description: "The kinetic layout with a high-contrast difference blend",
    renderer: "kinetic",
    fontFamily: "Montserrat",
    secondaryFontFamily: "Dancing Script",
    secondaryFontSizeScale: 0.52,
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.082,
    letterSpacingEm: -0.02,
    wordGapEm: 0.12,
    uppercase: false,
    textColor: "#FFFFFF",
    activeColor: "#FFD700",
    activeTextColor: "#FFD700",
    outlineWidthEm: 0.055,
    shadowColor: "rgba(0,0,0,0.6)",
    shadowBlurEm: 0.18,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.08,
    activeEffect: "color",
    activeTransitionSec: 0.1,
    entrance: "word-rise",
    entranceDurationSec: 0.3,
    entranceScaleFrom: 0.85,
    entranceBlurEm: 0,
    differenceBlend: true,
  },
  podcast: {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_SUBTLE_DARK_OUTLINE,
    id: "podcast",
    label: "Podcast",
    description: "Two kinetic headline rows with a rotating accent palette",
    renderer: "podcast",
    wordsPerGroup: 6,
    fontFamily: "Anton",
    fontWeight: 400,
    fontStyle: "normal",
    fontSizeRatio: 0.058,
    lineHeightRatio: 1.28,
    letterSpacingEm: 0.05,
    wordGapEm: 0.2,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#FF2D6B",
    activeTextColor: "#FF2D6B",
    shadowColor: "rgba(0,0,0,0.7)",
    shadowBlurEm: 0.15,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.07,
    activeEffect: "none",
    activeTransitionSec: 0,
    entrance: "word-scale",
    entranceDurationSec: 0.24,
    entranceScaleFrom: 0.8,
    entranceBlurEm: 0,
    accentColors: [
      "#FF2D6B",
      "#FF4500",
      "#00E676",
      "#FF9100",
      "#E040FB",
      "#00B0FF",
      "#FFEA00",
    ],
  },
  "lime-box": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_TRANSFORM,
    id: "lime-box",
    label: "Lime Box",
    description: "A Capicola box variation with an electric lime gradient",
    renderer: "phrase",
    fontFamily: "Barlow Condensed",
    fontWeight: 900,
    fontStyle: "normal",
    fontSizeRatio: 0.072,
    letterSpacingEm: 0.02,
    wordGapEm: 0.5,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#B7FF00",
    activeTextColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidthEm: 0.1,
    shadowColor: "rgba(0,0,0,0.55)",
    shadowBlurEm: 0.16,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.13,
    activeEffect: "gradient-pill",
    activeGradient: { from: "#D8FF45", to: "#8CD600" },
    activePaddingXEm: 0.27,
    activePaddingYEm: 0.1,
    activeRadiusEm: 0.27,
    activeTransitionSec: 0.15,
    entrance: "page-fade",
    entranceDurationSec: 0.15,
    entranceScaleFrom: 1,
    entranceBlurEm: 0,
  },
  "cyan-punch": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_PLATE,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    id: "cyan-punch",
    label: "Cyan Punch",
    description: "Capicola's outlined color style with a sharp cyan accent",
    renderer: "phrase",
    fontFamily: "Inter",
    fontWeight: 800,
    fontStyle: "normal",
    fontSizeRatio: 0.068,
    letterSpacingEm: 0,
    wordGapEm: 0.3,
    uppercase: true,
    textColor: "#FFFFFF",
    activeColor: "#00E5FF",
    activeTextColor: "#00E5FF",
    outlineColor: "#000000",
    outlineWidthEm: 0.11,
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurEm: 0.12,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0.1,
    activeEffect: "color",
    activeTransitionSec: 0.12,
    entrance: "page-fade",
    entranceDurationSec: 0.15,
    entranceScaleFrom: 1,
    entranceBlurEm: 0,
  },
  "light-bubble": {
    ...SHARED_CAPTION_LAYOUT,
    ...SHARED_NO_ACTIVE_BOX,
    ...SHARED_NO_TRANSFORM,
    ...SHARED_NO_ENTRANCE,
    id: "light-bubble",
    label: "Light Bubble",
    description: "A bright editorial variation of Capicola's clean bubble",
    renderer: "phrase",
    fontFamily: "Inter",
    fontWeight: 600,
    fontStyle: "normal",
    fontSizeRatio: 0.052,
    letterSpacingEm: 0,
    wordGapEm: 0.26,
    uppercase: false,
    textColor: "#111827",
    activeColor: "#6D28D9",
    activeTextColor: "#6D28D9",
    outlineColor: "transparent",
    outlineWidthEm: 0,
    shadowColor: "transparent",
    shadowBlurEm: 0,
    shadowOffsetXEm: 0,
    shadowOffsetYEm: 0,
    plateStyle: "group",
    plateColor: "#FFFFFF",
    plateOpacity: 0.88,
    plateRadiusEm: 0.38,
    platePaddingXEm: 0.67,
    platePaddingYEm: 0.29,
    activeEffect: "color",
    activeTransitionSec: 0.12,
  },
};

export const CLIPPER_CAPTION_PRESETS: readonly CaptionPresetDefinition[] =
  CLIPPER_CAPTION_PRESET_IDS.map((id) => CAPTION_PRESET_DEFINITIONS[id]);

const LEGACY_CAPTION_PRESET_ID_MAP: Readonly<
  Record<string, ClipperCaptionPresetId>
> = {
  "clean-cut": "capicola-bubble",
  "bold-punch": "capicola-color",
  highlighter: "capicola-box",
  "creator-card": "capicola-bubble",
  "sticker-stack": "grape",
};

export function isCaptionPresetId(
  value: unknown,
): value is ClipperCaptionPresetId {
  return (
    typeof value === "string" &&
    (CLIPPER_CAPTION_PRESET_IDS as readonly string[]).includes(value)
  );
}

export function normalizeCaptionPresetId(
  value: unknown,
  fallback: ClipperCaptionPresetId = DEFAULT_CAPTION_PRESET_ID,
): ClipperCaptionPresetId {
  if (isCaptionPresetId(value)) return value;
  if (typeof value === "string" && LEGACY_CAPTION_PRESET_ID_MAP[value]) {
    return LEGACY_CAPTION_PRESET_ID_MAP[value];
  }
  return fallback;
}

export function resolveCaptionPreset(
  id: ClipperCaptionPresetId | string | null | undefined,
): CaptionPresetDefinition {
  return CAPTION_PRESET_DEFINITIONS[normalizeCaptionPresetId(id)];
}

export function captionWordsPerGroup(
  captions:
    | {
        presetId?: ClipperCaptionPresetId | string;
        wordsPerGroup?: number;
      }
    | null
    | undefined,
): number {
  if (typeof captions?.wordsPerGroup === "number") {
    return Math.min(5, Math.max(1, Math.round(captions.wordsPerGroup)));
  }
  return resolveCaptionPreset(captions?.presetId).wordsPerGroup;
}

const CAPTION_FONT_REQUESTS = [
  '400 48px "Anton"',
  '900 48px "Barlow Condensed"',
  '700 48px "Dancing Script"',
  '600 48px "Inter"',
  '800 48px "Inter"',
  '900 italic 48px "Montserrat"',
  '800 48px "Outfit"',
  '900 48px "Outfit"',
  '900 48px "Poppins"',
  '700 48px "Rajdhani"',
] as const;

let captionFontsReadyPromise: Promise<void> | null = null;

export function ensureCaptionFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts)
    return Promise.resolve();
  captionFontsReadyPromise ??= Promise.all(
    CAPTION_FONT_REQUESTS.map((font) =>
      document.fonts.load(font, "Zażółć gęślą jaźń Make every moment count"),
    ),
  ).then(() => undefined);
  return captionFontsReadyPromise;
}
