import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { Box, ChakraProvider, createSystem, defaultConfig, Text } from "@chakra-ui/react";
import * as Sentry from "@sentry/react";
import { AuthInitializer } from "./features/authentication/components/auth-initalizer.component";
import { PublicRoute } from "./features/authentication/components/public-route.component";
import { ThemeProvider, useTheme } from "./theme";
import { ProjectLoadingScreen } from "./shared/components/project-loading-screen.component";
import { Toaster } from "./shared/components/ui/toaster.component";
import { OutlinedActionButton } from "./shared/components/buttons/outlined-action-button.component";
import { DesktopAuthBridge } from "./features/authentication/components/desktop-auth-bridge.component";
import { isTauri } from "./shared/utils/platform.util";
import { ensureTauriFrontendSession } from "./shared/utils/tauri-native-jobs.util";
import { AppUpdateInitializer } from "./features/settings/app-update-initializer.component";

const AuthPage = lazy(() =>
  import("./features/authentication/components/auth-page.component").then((m) => ({
    default: m.AuthPage,
  })),
);
const OAuthSuccess = lazy(() =>
  import("./features/authentication/components/oauth-success.component").then((m) => ({
    default: m.OAuthSuccess,
  })),
);
const OAuthYoutubeCallback = lazy(() =>
  import("./features/authentication/components/oauth-youtube-callback.component").then((m) => ({
    default: m.OAuthYoutubeCallback,
  })),
);
const OAuthMetaCallback = lazy(() =>
  import("./features/authentication/components/oauth-social-callbacks.component").then((m) => ({
    default: m.OAuthMetaCallback,
  })),
);
const OAuthInstagramCallback = lazy(() =>
  import("./features/authentication/components/oauth-social-callbacks.component").then((m) => ({
    default: m.OAuthInstagramCallback,
  })),
);
const OAuthThreadsCallback = lazy(() =>
  import("./features/authentication/components/oauth-social-callbacks.component").then((m) => ({
    default: m.OAuthThreadsCallback,
  })),
);
const OAuthTikTokCallback = lazy(() =>
  import("./features/authentication/components/oauth-social-callbacks.component").then((m) => ({
    default: m.OAuthTikTokCallback,
  })),
);
const OAuthXCallback = lazy(() =>
  import("./features/authentication/components/oauth-social-callbacks.component").then((m) => ({
    default: m.OAuthXCallback,
  })),
);
const ClipperHomePage = lazy(() =>
  import("./features/clipper/pages/clipper-home-page.component").then((m) => ({
    default: m.ClipperHomePage,
  })),
);
const ClipperSessionPage = lazy(() =>
  import("./features/clipper/pages/clipper-session-page.component").then((m) => ({
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
          path="/oauth/youtube-connected"
          element={<InteractiveRoute name="oauth-youtube"><OAuthYoutubeCallback /></InteractiveRoute>}
        />
        <Route path="/oauth/meta-connected" element={<InteractiveRoute name="oauth-meta"><OAuthMetaCallback /></InteractiveRoute>} />
        <Route path="/oauth/instagram-connected" element={<InteractiveRoute name="oauth-instagram"><OAuthInstagramCallback /></InteractiveRoute>} />
        <Route path="/oauth/threads-connected" element={<InteractiveRoute name="oauth-threads"><OAuthThreadsCallback /></InteractiveRoute>} />
        <Route
          path="/oauth/tiktok-connected"
          element={<InteractiveRoute name="oauth-tiktok"><OAuthTikTokCallback /></InteractiveRoute>}
        />
        <Route path="/oauth/x-connected" element={<InteractiveRoute name="oauth-x"><OAuthXCallback /></InteractiveRoute>} />
        <Route
          path="/clipper"
          element={<InteractiveRoute name="clipper-home"><ClipperHomePage /></InteractiveRoute>}
        />
        <Route
          path="/clipper/:projectId/*"
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

function SentryErrorFallback({
  error,
  resetError,
}: {
  error: unknown;
  resetError: () => void;
}) {
  const { theme } = useTheme();
  const message = error instanceof Error ? error.toString() : String(error ?? "Unknown error");

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      height="100vh"
      px={4}
      bg={theme.background.primary}
    >
      <Box
        maxW="2xl"
        w="100%"
        p={6}
        bg={theme.background.secondary}
        borderWidth="1px"
        borderStyle="solid"
        borderColor={theme.border.secondary}
      >
        <Text fontSize="xl" fontWeight="bold" color={theme.text.primary} mb={3}>
          Application Error
        </Text>
        <Text color={theme.text.muted} mb={4}>
          Something went wrong. The error has been reported. You can try again or restart the app.
        </Text>
        <Box
          mb={4}
          p={4}
          maxH="40vh"
          overflow="auto"
          bg={theme.background.tertiary}
          borderWidth="1px"
          borderStyle="solid"
          borderColor={theme.border.secondary}
        >
          <Text
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            color={theme.text.distinct}
            whiteSpace="pre-wrap"
          >
            {message}
          </Text>
        </Box>
        <OutlinedActionButton onClick={resetError}>Try again</OutlinedActionButton>
      </Box>
    </Box>
  );
}

function App() {
  return (
    <ThemeProvider defaultMode="dark">
      <ChakraProvider value={system}>
        <Sentry.ErrorBoundary fallback={SentryErrorFallback} showDialog={false}>
          <FrontendReadySignal />
          <AppUpdateInitializer>
            <Toaster />
            <Router basename={isTauri() ? "/" : import.meta.env.BASE_URL.replace(/\/+$/, "") || "/"}>
              <AppContent />
            </Router>
          </AppUpdateInitializer>
        </Sentry.ErrorBoundary>
      </ChakraProvider>
    </ThemeProvider>
  );
}

export default App;
