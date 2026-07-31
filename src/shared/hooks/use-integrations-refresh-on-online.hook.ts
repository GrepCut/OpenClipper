import { useEffect, useRef } from "react";
import { hasOnlineAccountAccess } from "../auth/account-access.util";
import { useAuthStore } from "../stores/use-auth-store.store";
import { useSocialStore } from "../../stores/use-social-store.store";
import { useYoutubeStore } from "../../stores/use-youtube-store.store";

/**
 * Re-fetches integration status when the desktop session transitions offline → online.
 * Covers the stale-while-revalidate startup path where views may have refreshed too early.
 */
export function useIntegrationsRefreshOnOnline(): void {
  const sessionMode = useAuthStore((state) => state.sessionMode);
  const prevSessionModeRef = useRef(sessionMode);

  useEffect(() => {
    const previousMode = prevSessionModeRef.current;
    prevSessionModeRef.current = sessionMode;

    if (previousMode !== "online" && sessionMode === "online" && hasOnlineAccountAccess()) {
      void useYoutubeStore.getState().refreshStatus();
      void useSocialStore.getState().refreshAll();
    }
  }, [sessionMode]);
}
