import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { AuthInitializer } from "./features/authentication/AuthInitalizer";
import { PublicRoute } from "./features/authentication/PublicRoute";
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
const OAuthMetaCallback = lazy(() =>
  import("./features/authentication/OAuthSocialCallbacks").then((m) => ({
    default: m.OAuthMetaCallback,
  })),
);
const OAuthInstagramCallback = lazy(() =>
  import("./features/authentication/OAuthSocialCallbacks").then((m) => ({
    default: m.OAuthInstagramCallback,
  })),
);
const OAuthTikTokCallback = lazy(() =>
  import("./features/authentication/OAuthSocialCallbacks").then((m) => ({
    default: m.OAuthTikTokCallback,
  })),
);
const OAuthLinkedInCallback = lazy(() =>
  import("./features/authentication/OAuthSocialCallbacks").then((m) => ({
    default: m.OAuthLinkedInCallback,
  })),
);
const OAuthXCallback = lazy(() =>
  import("./features/authentication/OAuthSocialCallbacks").then((m) => ({
    default: m.OAuthXCallback,
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
    void ensureTauriFrontendSession().catch(() => {});
  }, []);
  return null;
}

function InteractiveRoute({ name, children }: { name: string; children: React.ReactNode }) {
  useLayoutEffect(() => {
    (
      window as Window & {
        __OPEN_CLIPPER_MARK_INTERACTIVE__?: (route: string) => void;
      }
    ).__OPEN_CLIPPER_MARK_INTERACTIVE__?.(name);
  }, [name]);
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<ProjectLoadingScreen type="loading" />}>
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/clipper" replace />}
        />
        <Route
          path="/auth"
          element={
            <InteractiveRoute name="auth">
              <PublicRoute>
                <AuthPage />
              </PublicRoute>
            </InteractiveRoute>
          }
        />
        <Route path="/login" element={<Navigate to="/auth" replace />} />
        <Route path="/oauth/success" element={<InteractiveRoute name="oauth-success"><OAuthSuccess /></InteractiveRoute>} />
        <Route
          path="/oauth/google-drive-connected"
          element={<InteractiveRoute name="oauth-drive"><OAuthDriveCallback /></InteractiveRoute>}
        />
        <Route
          path="/oauth/youtube-connected"
          element={<InteractiveRoute name="oauth-youtube"><OAuthYoutubeCallback /></InteractiveRoute>}
        />
        <Route path="/oauth/meta-connected" element={<InteractiveRoute name="oauth-meta"><OAuthMetaCallback /></InteractiveRoute>} />
        <Route path="/oauth/instagram-connected" element={<InteractiveRoute name="oauth-instagram"><OAuthInstagramCallback /></InteractiveRoute>} />
        <Route
          path="/oauth/tiktok-connected"
          element={<InteractiveRoute name="oauth-tiktok"><OAuthTikTokCallback /></InteractiveRoute>}
        />
        <Route
          path="/oauth/linkedin-connected"
          element={<InteractiveRoute name="oauth-linkedin"><OAuthLinkedInCallback /></InteractiveRoute>}
        />
        <Route path="/oauth/x-connected" element={<InteractiveRoute name="oauth-x"><OAuthXCallback /></InteractiveRoute>} />
        <Route
          path="/clipper"
          element={<InteractiveRoute name="clipper-home"><ClipperHomePage /></InteractiveRoute>}
        />
        <Route
          path="/clipper/:projectId"
          element={<InteractiveRoute name="clipper-session"><ClipperSessionPage /></InteractiveRoute>}
        />
        <Route
          path="*"
          element={<Navigate to="/clipper" replace />}
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
        <FrontendReadySignal />
        <Toaster />
        <Router basename={isTauri() ? "/" : import.meta.env.BASE_URL.replace(/\/+$/, "") || "/"}>
          <AppContent />
        </Router>
      </ChakraProvider>
    </ThemeProvider>
  );
}

export default App;
