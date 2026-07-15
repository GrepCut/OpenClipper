import { toaster } from "../components/ui/toaster";
import { TOAST_DEFAULTS } from "./toast.messages";

type ToastType = "success" | "error" | "loading" | "info" | "warning";

export interface AppToastOptions {
  duration?: number;
  closable?: boolean;
}

/* ── Precomputed base configs (frozen, zero GC pressure) ── */
const BASE_CONFIGS = Object.freeze({
  success: Object.freeze({
    type: "success" as const,
    duration: TOAST_DEFAULTS.SUCCESS_DURATION,
    closable: true,
  }),
  error: Object.freeze({
    type: "error" as const,
    duration: TOAST_DEFAULTS.ERROR_DURATION,
    closable: true,
  }),
  info: Object.freeze({
    type: "info" as const,
    duration: TOAST_DEFAULTS.INFO_DURATION,
    closable: true,
  }),
  warning: Object.freeze({
    type: "warning" as const,
    duration: TOAST_DEFAULTS.INFO_DURATION,
    closable: true,
  }),
  loading: Object.freeze({
    type: "loading" as const,
    closable: false,
  }),
});

function buildConfig(
  type: ToastType,
  title: string,
  description?: string,
  opts?: AppToastOptions,
) {
  const base = BASE_CONFIGS[type];
  return {
    title,
    description,
    type: base.type,
    duration:
      opts?.duration ?? ("duration" in base ? base.duration : undefined),
    closable: opts?.closable ?? base.closable,
  };
}

/**
 * Centralny serwis do obsługi powiadomień w aplikacji.
 * Wszystkie pliki powinny importować `appToast` z tego modułu
 * zamiast bezpośrednio korzystać z `toaster` z Chakra UI.
 */
export const appToast = {
  success(title: string, description?: string, opts?: AppToastOptions): void {
    toaster.create(buildConfig("success", title, description, opts));
  },

  error(title: string, description?: string, opts?: AppToastOptions): void {
    toaster.create(buildConfig("error", title, description, opts));
  },

  info(title: string, description?: string, opts?: AppToastOptions): void {
    toaster.create(buildConfig("info", title, description, opts));
  },

  warning(title: string, description?: string, opts?: AppToastOptions): void {
    toaster.create(buildConfig("warning", title, description, opts));
  },

  /**
   * Wyświetla toast loading - trwa do czasu wywołania `update()`.
   * Zwraca ID toastu.
   */
  loading(title: string, description?: string): string {
    return toaster.create(buildConfig("loading", title, description));
  },

  update(
    id: string,
    type: ToastType,
    title: string,
    description?: string,
    opts?: AppToastOptions,
  ): void {
    toaster.update(id, buildConfig(type, title, description, opts));
  },
};
