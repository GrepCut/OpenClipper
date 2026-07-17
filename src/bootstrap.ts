type StartupLogLevel = "info" | "warn" | "error";

type TauriWindow = Window & {
  __OPEN_CLIPPER_STARTUP_LOG__?: (
    level: StartupLogLevel,
    message: string,
    details?: unknown,
  ) => void;
  __OPEN_CLIPPER_MARK_INTERACTIVE__?: (route: string) => void;
  __TAURI__?: {
    core?: {
      invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
};

function stringify(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ""}`.trim();
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function report(level: StartupLogLevel, message: string, details?: unknown): void {
  const invoke = (window as TauriWindow).__TAURI__?.core?.invoke;
  if (!invoke) return;
  void invoke("frontend_startup_log", {
    level,
    message,
    details: details === undefined ? null : stringify(details).slice(0, 20_000),
  }).catch(() => {});
}

(window as TauriWindow).__OPEN_CLIPPER_STARTUP_LOG__ = report;
let interactiveReported = false;
(window as TauriWindow).__OPEN_CLIPPER_MARK_INTERACTIVE__ = (route) => {
  if (interactiveReported) return;
  interactiveReported = true;
  document.getElementById("open-clipper-boot-shell")?.remove();
  report("info", "interactive route committed", {
    route,
    navigationMs: Math.round(performance.now()),
  });
};

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  report("error", "console.error", args.map(stringify).join(" | "));
};

console.warn = (...args: unknown[]) => {
  originalConsoleWarn(...args);
  report("warn", "console.warn", args.map(stringify).join(" | "));
};

window.addEventListener("error", (event) => {
  report("error", "uncaught window error", {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    error: stringify(event.error),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  report("error", "unhandled promise rejection", event.reason);
});

report("info", "frontend bootstrap started", window.location.href);

window.setTimeout(() => {
  report("info", "frontend event loop heartbeat after 1 second");
}, 1_000);

const rootElement = document.getElementById("root");
if (rootElement) {
  const rootObserver = new MutationObserver(() => {
    if (rootElement.childNodes.length > 0) {
      report("info", "React committed its first DOM content", {
        childNodes: rootElement.childNodes.length,
        textPreview: rootElement.textContent?.slice(0, 200),
        navigationMs: Math.round(performance.now()),
      });
      rootObserver.disconnect();
    }
  });
  rootObserver.observe(rootElement, { childList: true, subtree: true });
} else {
  report("error", "root DOM element is missing before frontend import");
}

void import("./main.tsx")
  .then(() => report("info", "frontend entry module loaded"))
  .catch((error) => {
    report("error", "frontend entry module failed to load", error);
  });
