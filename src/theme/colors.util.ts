export const colors = {
  purple: {
    royal: "#003D80",
    medium: "#1E90FF",
    accent1: "#007BFF",
    accent2: "#0056B3",
  },

  dark: {
    background: {
      primary: "#010409",
      secondary: "#0D1117",
      tertiary: "#212830",
      surface: "#1a1a1a",
      overlay: "rgba(0, 0, 0, 0.5)",
      card: "#0D1117",
      hover: "#161B22",
    },

    text: {
      primary: "#ffffff",
      secondary: "#ffffff",
      muted: "#9198A1",
      distinct: "#C9D1D9",
      disabled: "#666666",
      onBrand: "rgba(255, 255, 255, 0.92)",
      onBrandMuted: "rgba(255, 255, 255, 0.85)",
      toggleThumbActive: "rgba(255, 255, 255, 0.82)",
      toggleThumbInactive: "rgba(255, 255, 255, 0.42)",
    },

    surface: {
      faint: "rgba(255, 255, 255, 0.02)",
      inset: "rgba(255, 255, 255, 0.03)",
      subtle: "rgba(255, 255, 255, 0.04)",
      muted: "rgba(255, 255, 255, 0.06)",
      hover: "rgba(255, 255, 255, 0.08)",
      active: "rgba(255, 255, 255, 0.1)",
      elevated: "rgba(255, 255, 255, 0.24)",
      elevatedHover: "rgba(255, 255, 255, 0.36)",
      focus: "rgba(255, 255, 255, 0.2)",
      previewMuted: "rgba(255, 255, 255, 0.3)",
      borderStrong: "rgba(255, 255, 255, 0.14)",
    },

    overlay: {
      modal: "rgba(0, 0, 0, 0.82)",
    },

    shadow: {
      panel: "0 4px 16px rgba(0, 0, 0, 0.28)",
      panelFocus:
        "0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.4)",
      toolbar: "0px 2px 8px rgba(0, 0, 0, 0.15)",
      dropdown: "0 16px 36px rgba(0, 0, 0, 0.42)",
    },

    interactive: {
      playhead: "#00f3ff",
      playheadSecondary: "#0066cc",
      selectedClipStart: "#ff4d9d",
      selectedClipEnd: "#ff0072",
      selectedClipStroke: "#ff99c2",
      unselectedClipStart: "#6ba5e7",
      unselectedClipEnd: "#4a90e2",
      unselectedClipStroke: "#8ab7e8",
      marker: "#FFD700",
      waveform: "#ffffff",
      waveformRms: "#cccccc",
      audioPlaceholder: "#333333",
      magneticClipping: "#00FFFF",
      destructiveHover: "rgba(220, 38, 38, 0.15)",
      trackLock: "#00C3FF",
      trackVisibility: "#60a5fa",
      iconHover: "rgba(255, 255, 255, 0.08)",
    },

    brand: {
      purple: "#007BFF",
      purpleLight: "#1E90FF",
      purpleDark: "#0056B3",
      royal: "#003D80",
      purpleSoft: "#00C3FF",
      purpleText: "#B8E8FF",
      purpleGlow: "rgba(30, 144, 255, 0.6)",
      purpleGlowLight: "rgba(0, 123, 255, 0.5)",
      purpleSoftAlpha12: "rgba(0, 195, 255, 0.12)",
      purpleSoftAlpha85: "rgba(0, 195, 255, 0.85)",
      purpleTextStroke: "rgba(184, 232, 255, 0.3)",
      toggleActiveBg: "rgba(0, 123, 255, 0.08)",
      toggleActiveBorder: "rgba(30, 144, 255, 0.35)",
      toggleActiveHoverBg: "rgba(0, 123, 255, 0.13)",
      toggleActiveHoverBorder: "rgba(30, 144, 255, 0.55)",
    },

    status: {
      success: "#38ef7d",
      successSecondary: "#11998e",
      error: "#c31432",
      errorSecondary: "#240b36",
      warning: "#ff9500",
      info: "#0066cc",
      infoGradient: ["#24243e", "#0a3a6e", "#0f0c29"],
      danger: "#ff4444",
      dragPreview: "#4CAF50",
      chatToolFailed: "#ffa657",
    },

    border: {
      primary: "rgba(255, 255, 255, 0.1)",
      secondary: "rgba(255, 255, 255, 0.05)",
      focus: "#4CAF50",
    },

    scrollbar: {
      track: "black",
      thumb: "#9198A1",
    },

    dashboard: {
      background: "#050505",
      card: "#161b22",
      cardHover: "#1f2428",
      accent1: "#007BFF",
      accent2: "#FF1493",
      accent3: "#00E5FF",
      gradientMain:
        "linear-gradient(to right bottom, #0d1117, #161b22, #0d1117)",
      gradientCard: "linear-gradient(145deg, #161b22, #0d1117)",
      glass: "rgba(22, 27, 34, 0.6)",
      border: "rgba(240, 246, 252, 0.1)",
    },

    timeline: {
      emptyOverlayBackground: "#010409",
      emptyOverlayText: "#9198A1",
    },
  },

  light: {
    background: {
      primary: "#FEF9E7",
      secondary: "#FDF5E6",
      tertiary: "#FAF0DC",
      surface: "#FFFAEB",
      overlay: "rgba(139, 126, 95, 0.15)",
      card: "#FFFFFF",
      hover: "#FFF9E6",
    },

    text: {
      primary: "#3E3723",
      secondary: "#5C5439",
      muted: "#8B7E5F",
      distinct: "#4A4230",
      disabled: "#B8AF9C",
      onBrand: "#ffffff",
      onBrandMuted: "rgba(255, 255, 255, 0.9)",
      toggleThumbActive: "#ffffff",
      toggleThumbInactive: "rgba(62, 55, 35, 0.45)",
    },

    surface: {
      faint: "rgba(0, 0, 0, 0.02)",
      inset: "rgba(0, 0, 0, 0.03)",
      subtle: "rgba(0, 0, 0, 0.04)",
      muted: "rgba(0, 0, 0, 0.06)",
      hover: "rgba(0, 0, 0, 0.06)",
      active: "rgba(0, 0, 0, 0.08)",
      elevated: "rgba(139, 126, 95, 0.2)",
      elevatedHover: "rgba(139, 126, 95, 0.3)",
      focus: "rgba(139, 126, 95, 0.35)",
      previewMuted: "rgba(139, 126, 95, 0.25)",
      borderStrong: "rgba(139, 126, 95, 0.2)",
    },

    overlay: {
      modal: "rgba(255, 255, 255, 0.82)",
    },

    shadow: {
      panel: "0 4px 16px rgba(0, 0, 0, 0.08)",
      panelFocus:
        "0 0 0 1px rgba(139, 126, 95, 0.15), 0 8px 24px rgba(0, 0, 0, 0.12)",
      toolbar: "0px 2px 8px rgba(0, 0, 0, 0.08)",
      dropdown: "0 16px 36px rgba(0, 0, 0, 0.15)",
    },

    interactive: {
      playhead: "#E67E22",
      playheadSecondary: "#D35400",
      selectedClipStart: "#F39C12",
      selectedClipEnd: "#E67E22",
      selectedClipStroke: "#F8C471",
      unselectedClipStart: "#F1C40F",
      unselectedClipEnd: "#D4AC0D",
      unselectedClipStroke: "#F9E79F",
      marker: "#F39C12",
      waveform: "#5C5439",
      waveformRms: "#8B7E5F",
      audioPlaceholder: "#FAF0DC",
      magneticClipping: "#F39C12",
      destructiveHover: "rgba(192, 57, 43, 0.12)",
      trackLock: "#007BFF",
      trackVisibility: "#E67E22",
      iconHover: "rgba(0, 0, 0, 0.06)",
    },

    brand: {
      purple: "#007BFF",
      purpleLight: "#1E90FF",
      purpleDark: "#0056B3",
      royal: "#003D80",
      purpleSoft: "#00C3FF",
      purpleText: "#ffffff",
      purpleGlow: "rgba(0, 123, 255, 0.5)",
      purpleGlowLight: "rgba(0, 123, 255, 0.5)",
      purpleSoftAlpha12: "rgba(0, 195, 255, 0.12)",
      purpleSoftAlpha85: "rgba(0, 195, 255, 0.85)",
      purpleTextStroke: "rgba(255, 255, 255, 0.4)",
      toggleActiveBg: "rgba(0, 123, 255, 0.07)",
      toggleActiveBorder: "rgba(30, 144, 255, 0.4)",
      toggleActiveHoverBg: "rgba(0, 123, 255, 0.12)",
      toggleActiveHoverBorder: "rgba(30, 144, 255, 0.5)",
    },

    status: {
      success: "#27AE60",
      successSecondary: "#52BE80",
      error: "#C0392B",
      errorSecondary: "#F5B7B1",
      warning: "#F39C12",
      info: "#E67E22",
      infoGradient: ["#FEF5E0", "#FDF5E6", "#FFF9E6"],
      danger: "#C0392B",
      dragPreview: "#27AE60",
      chatToolFailed: "#F39C12",
    },

    border: {
      primary: "rgba(139, 126, 95, 0.2)",
      secondary: "rgba(139, 126, 95, 0.1)",
      focus: "#F39C12",
    },

    scrollbar: {
      track: "#FEF9E7",
      thumb: "#D4AC0D",
    },

    dashboard: {
      background: "#FEF5E0",
      card: "#FFFEF9",
      cardHover: "#FFF9E6",
      accent1: "#F39C12",
      accent2: "#F1C40F",
      accent3: "#E67E22",
      gradientMain:
        "linear-gradient(to right bottom, #FEF5E0, #FFFEF9, #FFF9E6)",
      gradientCard: "linear-gradient(145deg, #FFFEF9, #FEF5E0)",
      glass: "rgba(255, 250, 235, 0.85)",
      border: "rgba(139, 126, 95, 0.15)",
    },

    timeline: {
      emptyOverlayBackground: "#FEF9E7",
      emptyOverlayText: "#000000",
    },
  },
};

export type Theme = typeof colors.dark;
export type ThemeMode = "dark" | "light";

export const getThemeColors = (mode: ThemeMode): Theme => {
  return colors[mode];
};
