import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { AuthInitializer } from "./features/authentication/AuthInitalizer";
import { PublicRoute } from "./features/authentication/PublicRoute";
import { ProtectedRoute } from "./features/authentication/ProtectedRoute";
import { ThemeProvider, useTheme } from "./theme";
import { ProjectLoadingScreen } from "./shared/components/ProjectLoadingScreen";
import { Toaster } from "./shared/components/ui/toaster";
import { DesktopAuthBridge } from "./features/authentication/DesktopAuthBridge";
import { isTauri } from "./shared/utils/platform";
import { ensureTauriFrontendSession } from "./shared/utils/tauri-native-jobs";

const AuthPage = lazy(() =>
  import("./features/authentication/AuthPage").then((m) => ({
    default: m.AuthPage,
  })),
);
const OAuthSuccess = lazy(() =>
  import("./features/authentication/OAuthSuccess").then((m) => ({
    default: m.OAuthSuccess,
  })),
);
const OAuthDriveCallback = lazy(() =>
  import("./features/authentication/OAuthDriveCallback").then((m) => ({
    default: m.OAuthDriveCallback,
  })),
);
const OAuthYoutubeCallback = lazy(() =>
  import("./features/authentication/OAuthYoutubeCallback").then((m) => ({
    default: m.OAuthYoutubeCallback,
  })),
);
const ClipperHomePage = lazy(() =>
  import("./features/clipper/pages/ClipperHomePage").then((m) => ({
    default: m.ClipperHomePage,
  })),
);
const ClipperSessionPage = lazy(() =>
  import("./features/clipper/pages/ClipperSessionPage").then((m) => ({
    default: m.ClipperSessionPage,
  })),
);

const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#e3f2fd" },
          100: { value: "#bbdefb" },
          200: { value: "#90caf9" },
          300: { value: "#64b5f6" },
          400: { value: "#42a5f5" },
          500: { value: "#2196f3" },
          600: { value: "#1e88e5" },
          700: { value: "#1976d2" },
          800: { value: "#1565c0" },
          900: { value: "#0d47a1" },
        },
      },
      fonts: {
        heading: {
          value: `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`,
        },
        body: {
          value: `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`,
        },
      },
    },
  },
});

function FrontendReadySignal() {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      void ensureTauriFrontendSession().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

function AppRoutes() {
  return (
    <Suspense fallback={<ProjectLoadingScreen type="loading" />}>
      <FrontendReadySignal />
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Navigate to="/clipper" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/auth"
          element={
            <PublicRoute>
              <AuthPage />
            </PublicRoute>
          }
        />
        <Route path="/login" element={<Navigate to="/auth" replace />} />
        <Route path="/oauth/success" element={<OAuthSuccess />} />
        <Route
          path="/oauth/google-drive-connected"
          element={<OAuthDriveCallback />}
        />
        <Route
          path="/oauth/youtube-connected"
          element={<OAuthYoutubeCallback />}
        />
        <Route
          path="/clipper"
          element={
            <ProtectedRoute>
              <ClipperHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clipper/:projectId"
          element={
            <ProtectedRoute>
              <ClipperSessionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={<Navigate to={isTauri() ? "/auth" : "/clipper"} replace />}
        />
      </Routes>
    </Suspense>
  );
}

function AppContent() {
  const { theme } = useTheme();

  useEffect(() => {
    if (!isTauri()) return;
    const block = (e: KeyboardEvent) => {
      if (
        e.key === "F5" ||
        (e.ctrlKey && e.key === "r") ||
        (e.ctrlKey && e.shiftKey && e.key === "r")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        backgroundColor: theme.background.secondary,
      }}
    >
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <DesktopAuthBridge />
        <AuthInitializer>
          <AppRoutes />
        </AuthInitializer>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider defaultMode="dark">
      <ChakraProvider value={system}>
        <Toaster />
        <Router basename={import.meta.env.BASE_URL.replace(/\/+$/, "") || "/"}>
          <AppContent />
        </Router>
      </ChakraProvider>
    </ThemeProvider>
  );
}

export default App;
