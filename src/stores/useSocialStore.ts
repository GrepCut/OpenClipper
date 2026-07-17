import { create } from "zustand";
import { socialAuthService } from "../services/socialAuth.service";
import type { SocialPublishablePlatform } from "../services/types/socialAuth.types";

type PlatformState = {
  connected: boolean;
  displayName: string | null;
  isChecking: boolean;
};

type SocialStore = {
  platforms: Record<SocialPublishablePlatform, PlatformState>;
  refreshStatus: (platform: SocialPublishablePlatform) => Promise<void>;
  refreshAll: () => Promise<void>;
  setConnected: (
    platform: SocialPublishablePlatform,
    connected: boolean,
    displayName?: string | null,
  ) => void;
};

const empty = (): PlatformState => ({
  connected: false,
  displayName: null,
  isChecking: false,
});

const INITIAL: Record<SocialPublishablePlatform, PlatformState> = {
  youtube: empty(),
  facebook: empty(),
  instagram: empty(),
  tiktok: empty(),
  linkedin: empty(),
  x: empty(),
};

export const useSocialStore = create<SocialStore>((set, get) => ({
  platforms: INITIAL,

  setConnected: (platform, connected, displayName = null) => {
    set((state) => ({
      platforms: {
        ...state.platforms,
        [platform]: {
          ...state.platforms[platform],
          connected,
          displayName,
          isChecking: false,
        },
      },
    }));
  },

  refreshStatus: async (platform) => {
    set((state) => ({
      platforms: {
        ...state.platforms,
        [platform]: { ...state.platforms[platform], isChecking: true },
      },
    }));
    try {
      const status = await socialAuthService.checkConnection(platform);
      get().setConnected(
        platform,
        status.connected,
        status.displayName ?? null,
      );
    } catch {
      get().setConnected(platform, false, null);
    }
  },

  refreshAll: async () => {
    const platforms: SocialPublishablePlatform[] = [
      "facebook",
      "instagram",
      "tiktok",
      "linkedin",
      "x",
    ];
    await Promise.all(platforms.map((p) => get().refreshStatus(p)));
  },
}));
