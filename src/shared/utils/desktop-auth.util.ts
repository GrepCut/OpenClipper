import { isTauri } from "./platform.util";

export const AUTH_SESSION_KEY = "openclipper_has_session";
export const DESKTOP_REFRESH_TOKEN_KEY = "openclipper_desktop_refresh_token";
export const DESKTOP_DEEP_LINK_SCHEME = "openclipper";
const DESKTOP_EXCHANGED_TICKET_PREFIX = "openclipper_desktop_ticket_exchanged:";

type DeepLinkHandler = (urls: string[]) => void;

const getTauriGlobal = (): any =>
  (window as any).__TAURI__ ?? (window as any).__TAURI_INTERNALS__ ?? null;

const getDeepLinkApi = () => getTauriGlobal()?.deepLink ?? null;

const getOpenerApi = () => getTauriGlobal()?.opener ?? null;

export const getDesktopRefreshToken = (): string | null =>
  localStorage.getItem(DESKTOP_REFRESH_TOKEN_KEY);

export const setDesktopRefreshToken = (
  refreshToken: string | null | undefined,
): void => {
  if (!refreshToken) {
    localStorage.removeItem(DESKTOP_REFRESH_TOKEN_KEY);
    return;
  }

  localStorage.setItem(DESKTOP_REFRESH_TOKEN_KEY, refreshToken);
};

export const clearDesktopRefreshToken = (): void => {
  localStorage.removeItem(DESKTOP_REFRESH_TOKEN_KEY);
};

export const hasDesktopTicketBeenExchanged = (ticket: string): boolean => {
  return sessionStorage.getItem(`${DESKTOP_EXCHANGED_TICKET_PREFIX}${ticket}`) === "true";
};

export const markDesktopTicketAsExchanged = (ticket: string): void => {
  sessionStorage.setItem(`${DESKTOP_EXCHANGED_TICKET_PREFIX}${ticket}`, "true");
};

export const isDesktopAuthSessionAvailable = (): boolean =>
  isTauri() && !!getDesktopRefreshToken();

export const openExternalAuthUrl = async (url: string): Promise<void> => {
  if (isTauri()) {
    const opener = getOpenerApi();
    if (typeof opener?.openUrl === "function") {
      await opener.openUrl(url);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  window.location.assign(url);
};

export const getCurrentDesktopDeepLinks = async (): Promise<string[]> => {
  const deepLink = getDeepLinkApi();
  if (typeof deepLink?.getCurrent !== "function") {
    return [];
  }

  const urls = await deepLink.getCurrent();
  return Array.isArray(urls) ? urls : [];
};

export const listenToDesktopDeepLinks = async (
  handler: DeepLinkHandler,
): Promise<() => void> => {
  const deepLink = getDeepLinkApi();
  if (typeof deepLink?.onOpenUrl !== "function") {
    return () => {};
  }

  const unlisten = await deepLink.onOpenUrl((urls: string[]) => {
    if (Array.isArray(urls) && urls.length > 0) {
      handler(urls);
    }
  });

  return typeof unlisten === "function" ? unlisten : () => {};
};

export const parseDesktopDeepLink = (
  rawUrl: string,
): { route: string; search: string } | null => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${DESKTOP_DEEP_LINK_SCHEME}:`) {
      return null;
    }

    const route = `/${url.hostname}${url.pathname}`.replace(/\/{2,}/g, "/");
    if (!route.startsWith("/oauth/")) {
      return null;
    }

    return {
      route,
      search: url.search,
    };
  } catch {
    return null;
  }
};
