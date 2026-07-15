import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getCurrentDesktopDeepLinks,
  listenToDesktopDeepLinks,
  parseDesktopDeepLink,
} from "../../shared/utils/desktopAuth";
import { isTauri } from "../../shared/utils/platform";

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
    if (!parsed) continue;

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

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const currentPathWithSearch = `${location.pathname}${location.search}`;

    void getCurrentDesktopDeepLinks().then((urls) => {
      navigateToDeepLink(urls, navigate, currentPathWithSearch);
    });

    let dispose = () => {};
    void listenToDesktopDeepLinks((urls) => {
      navigateToDeepLink(urls, navigate, currentPathWithSearch);
    }).then((unlisten) => {
      dispose = unlisten;
    });

    return () => {
      dispose();
    };
  }, [location.pathname, location.search, navigate]);

  return null;
}
