import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getCurrentDesktopDeepLinks,
  listenToDesktopDeepLinks,
  parseDesktopDeepLink,
} from "../../../shared/utils/desktop-auth.util";
import { isTauri } from "../../../shared/utils/platform.util";

const handledDeepLinks = new Set<string>();

const navigateToDeepLink = (
  urls: string[],
  navigate: ReturnType<typeof useNavigate>,
  currentPathWithSearch: string,
) => {
  for (const url of urls) {
    if (handledDeepLinks.has(url)) {
      continue;
    }

    const parsed = parseDesktopDeepLink(url);
    if (!parsed) {
      continue;
    }

    const target = `${parsed.route}${parsed.search}`;
    handledDeepLinks.add(url);

    if (target === currentPathWithSearch) {
      return;
    }

    navigate(target, { replace: true });
    return;
  }
};

export function DesktopAuthBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPathRef = useRef(`${location.pathname}${location.search}`);

  useEffect(() => {
    currentPathRef.current = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    void getCurrentDesktopDeepLinks().then((urls) => {
      if (urls.length > 0) {
        navigateToDeepLink(urls, navigate, currentPathRef.current);
      }
    });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const deepLinkApi = (window as Window & { __TAURI__?: { deepLink?: unknown } })
      .__TAURI__?.deepLink as { onOpenUrl?: unknown } | undefined;
    if (typeof deepLinkApi?.onOpenUrl !== "function") {
      console.warn(
        "[DesktopAuthBridge] deepLink.onOpenUrl unavailable — OAuth redirect may not work",
      );
      return;
    }

    let dispose = () => {};
    void listenToDesktopDeepLinks((urls) => {
      navigateToDeepLink(urls, navigate, currentPathRef.current);
    }).then((unlisten) => {
      dispose = unlisten;
    });

    return () => {
      dispose();
    };
  }, [navigate]);

  return null;
}
