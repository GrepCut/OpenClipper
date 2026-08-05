import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./app.component";
import { getStoredThemeMode, syncThemeToDocument } from "./theme";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-ext-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-ext-800.css";
import "@fontsource/barlow-condensed/latin-900.css";
import "@fontsource/barlow-condensed/latin-ext-900.css";
import "@fontsource/anton/latin-400.css";
import "@fontsource/anton/latin-ext-400.css";
import "@fontsource/dancing-script/latin-700.css";
import "@fontsource/dancing-script/latin-ext-700.css";
import "@fontsource/montserrat/latin-900-italic.css";
import "@fontsource/montserrat/latin-ext-900-italic.css";
import "@fontsource/outfit/latin-800.css";
import "@fontsource/outfit/latin-ext-800.css";
import "@fontsource/outfit/latin-900.css";
import "@fontsource/outfit/latin-ext-900.css";
import "@fontsource/poppins/latin-900.css";
import "@fontsource/poppins/latin-ext-900.css";
import "@fontsource/rajdhani/latin-700.css";
import "@fontsource/rajdhani/latin-ext-700.css";
import "./shared/styles/app-drag-region.css";
import { ensureCaptionFontsReady } from "./features/clipper/lib/captions/caption-presets.util";

const WEBVIEW_CRASH_STORAGE_KEY = "oc_webview_crash";

function flushWebViewCrashReport(): void {
  try {
    const raw = sessionStorage.getItem(WEBVIEW_CRASH_STORAGE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(WEBVIEW_CRASH_STORAGE_KEY);
    let payload: { at?: number; kind?: string } = {};
    try {
      payload = JSON.parse(raw) as { at?: number; kind?: string };
    } catch {
      payload = {};
    }
    Sentry.captureMessage("WebView2 render process exited", {
      level: "error",
      tags: { webview_crash: "true", kind: payload.kind ?? "render-process-exited" },
      extra: { at: payload.at, raw },
    });
  } catch {
  }
}

if (import.meta.env.PROD) {
  const initTelemetry = () => {
    if (!import.meta.env.VITE_SENTRY_DSN) return;
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      environment: import.meta.env.MODE,
      release: `open-clipper@${import.meta.env.VITE_APP_VERSION || "dev"}`,
      initialScope: {
        tags: { platform: "tauri" },
      },
    });
    flushWebViewCrashReport();
    import("./sentry-replay-init").catch(() => {});
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(initTelemetry, { timeout: 5000 });
  } else {
    setTimeout(initTelemetry, 3000);
  }
}

syncThemeToDocument(getStoredThemeMode("dark"));

const rootElement = document.getElementById("root");
if (!rootElement) {
  const error = new Error("Missing #root element");
  throw error;
}

const reactRoot = ReactDOM.createRoot(rootElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

void ensureCaptionFontsReady().finally(() => {
  reactRoot.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
