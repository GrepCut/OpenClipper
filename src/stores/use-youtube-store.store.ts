import { create } from "zustand";
import { youtubeAuthService } from "../services/youtube-auth.service";
import type { SocialConnectionSummary } from "../services/types/youtube-auth.types";

interface YoutubeStoreState {
  connections: SocialConnectionSummary[];
  isConnected: boolean;
  channelTitle: string | null;
  isChecking: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  setConnections: (connections: SocialConnectionSummary[]) => void;
}

export const useYoutubeStore = create<YoutubeStoreState>((set) => ({
  connections: [],
  isConnected: false,
  channelTitle: null,
  isChecking: false,
  error: null,

  setConnections: (connections) => {
    set({
      connections,
      isConnected: connections.length > 0,
      channelTitle: connections[0]?.displayName ?? null,
      isChecking: false,
      error: null,
    });
  },

  refreshStatus: async () => {
    set({ isChecking: true, error: null });
    try {
      const status = await youtubeAuthService.checkYoutubeConnection();
      set({
        connections: status.connections ?? [],
        isConnected: status.connected,
        channelTitle:
          status.channelTitle ?? status.connections?.[0]?.displayName ?? null,
        isChecking: false,
        error: null,
      });
    } catch (error) {
      console.error("[YouTube Auth] useYoutubeStore.refreshStatus: failed", error);
      set({
        connections: [],
        isConnected: false,
        channelTitle: null,
        isChecking: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to check YouTube connection",
      });
    }
  },
}));
