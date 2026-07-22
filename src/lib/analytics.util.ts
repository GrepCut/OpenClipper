import { isWeb } from "../shared/utils/platform.util";

export type AnalyticsEventParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

function gtag(...args: unknown[]) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag(...args);
  }
}

export function trackEvent(name: string, params?: AnalyticsEventParams) {
  if (!isWeb()) return;
  gtag("event", name, params);
}
