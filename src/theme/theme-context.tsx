import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { getThemeColors, type Theme, type ThemeMode } from "./colors";

export const THEME_STORAGE_KEY = "clipper-theme";

export const getStoredThemeMode = (
  defaultMode: ThemeMode = "dark",
): ThemeMode => {
  if (typeof window === "undefined") {
    return defaultMode;
  }

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return defaultMode;
};

export const syncThemeToDocument = (mode: ThemeMode): void => {
  if (typeof document === "undefined") {
    return;
  }

  const theme = getThemeColors(mode);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;

  if (document.body) {
    document.body.style.backgroundColor = theme.background.primary;
    document.body.style.color = theme.text.primary;
  }

  const themeColorMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", theme.background.primary);
  }
};

interface ThemeContextType {
  theme: Theme;
  mode: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultMode?: ThemeMode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultMode = "dark",
}) => {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return getStoredThemeMode(defaultMode);
  });

  const theme = getThemeColors(mode);

  useLayoutEffect(() => {
    syncThemeToDocument(mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  }, [mode]);

  const toggleTheme = () => {
    setMode((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const setTheme = (newMode: ThemeMode) => {
    setMode(newMode);
  };

  const value: ThemeContextType = {
    theme,
    mode,
    toggleTheme,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
