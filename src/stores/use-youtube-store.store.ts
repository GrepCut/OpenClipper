import { create } from "zustand";
import { youtubeAuthService } from "../services/youtube-auth.service";

interface YoutubeStoreState {
  isConnected: boolean;
  channelTitle: string | null;
  isChecking: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  setConnected: (connected: boolean, channelTitle?: string | null) => void;
}

export const useYoutubeStore = create<YoutubeStoreState>((set) => ({
  isConnected: false,
  channelTitle: null,
  isChecking: false,
  error: null,

  setConnected: (connected, channelTitle = null) => {
    set({
      isConnected: connected,
      channelTitle: channelTitle ?? null,
      isChecking: false,
      error: null,
    });
  },

  refreshStatus: async () => {
    console.log("[YouTube Auth] useYoutubeStore.refreshStatus: start");
    set({ isChecking: true, error: null });
    try {
      const status = await youtubeAuthService.checkYoutubeConnection();
      console.log("[YouTube Auth] useYoutubeStore.refreshStatus: success", status);
      set({
        isConnected: status.connected,
        channelTitle: status.channelTitle ?? null,
        isChecking: false,
        error: null,
      });
    } catch (error) {
      console.error("[YouTube Auth] useYoutubeStore.refreshStatus: failed", error);
      set({
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
