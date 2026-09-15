import { socialAuthService } from "../services/social-auth.service";
import type { MetaTargetsResponse } from "../services/types/social-auth.types";
import { useSocialStore } from "./use-social-store.store";
import { useYoutubeStore } from "./use-youtube-store.store";

/**
 * Single round-trip for every publish-platform connection plus pending Meta page picks.
 * Hydrates both Zustand stores so Integrations / Publish / Owners share one backend hit.
 */
export async function refreshAllIntegrations(): Promise<MetaTargetsResponse | null> {
  useYoutubeStore.setState({ isChecking: true, error: null });
  useSocialStore.getState().beginCheckAll();
  try {
    const all = await socialAuthService.checkAllConnections();
    useYoutubeStore.getState().applyStatus(all.platforms.youtube);
    useSocialStore.getState().applyAll(all.platforms);
    return all.metaTargets;
  } catch (error) {
    console.error("[Integrations] refreshAllIntegrations failed", error);
    useYoutubeStore.setState({ isChecking: false });
    useSocialStore.getState().endCheckAll();
    return null;
  }
}
