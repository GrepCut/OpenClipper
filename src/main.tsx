import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.component";
import { getStoredThemeMode, syncThemeToDocument } from "./theme";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./shared/styles/app-drag-region.css";

type StartupLog = (
  level: "info" | "warn" | "error",
  message: string,
  details?: unknown,
) => void;

const startupLog = (
  window as Window & { __OPEN_CLIPPER_STARTUP_LOG__?: StartupLog }
).__OPEN_CLIPPER_STARTUP_LOG__;

const describeError = (error: unknown): string =>
  error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack ?? ""}`.trim()
    : String(error);

startupLog?.("info", "main.tsx execution started");
syncThemeToDocument(getStoredThemeMode("dark"));
startupLog?.("info", "initial theme synchronized");

const rootElement = document.getElementById("root");
if (!rootElement) {
  const error = new Error("Missing #root element");
  startupLog?.("error", "React root element lookup failed", error);
  throw error;
}

startupLog?.("info", "creating React root");
const reactRoot = ReactDOM.createRoot(rootElement, {
  onUncaughtError: (error, errorInfo) => {
    startupLog?.("error", "React uncaught error", {
      error: describeError(error),
      componentStack: errorInfo.componentStack,
    });
  },
  onCaughtError: (error, errorInfo) => {
    startupLog?.("error", "React error boundary caught an error", {
      error: describeError(error),
      componentStack: errorInfo.componentStack,
    });
  },
  onRecoverableError: (error, errorInfo) => {
    startupLog?.("warn", "React recoverable error", {
      error: describeError(error),
      componentStack: errorInfo.componentStack,
    });
  },
});

reactRoot.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
startupLog?.("info", "React render scheduled");
