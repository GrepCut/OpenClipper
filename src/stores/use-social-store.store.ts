import { create } from "zustand";
import { socialAuthService } from "../services/social-auth.service";
import type {
  SocialConnectionSummary,
  SocialPublishablePlatform,
} from "../services/types/social-auth.types";

type PlatformState = {
  connections: SocialConnectionSummary[];
  connected: boolean;
  displayName: string | null;
  isChecking: boolean;
};

type SocialStore = {
  platforms: Record<SocialPublishablePlatform, PlatformState>;
  refreshStatus: (platform: SocialPublishablePlatform) => Promise<void>;
  refreshAll: () => Promise<void>;
  setConnections: (
    platform: SocialPublishablePlatform,
    connections: SocialConnectionSummary[],
  ) => void;
};

const empty = (): PlatformState => ({
  connections: [],
  connected: false,
  displayName: null,
  isChecking: false,
});

const INITIAL: Record<SocialPublishablePlatform, PlatformState> = {
  youtube: empty(),
  facebook: empty(),
  instagram: empty(),
  threads: empty(),
  tiktok: empty(),
  x: empty(),
};

export const useSocialStore = create<SocialStore>((set, get) => ({
  platforms: INITIAL,

  setConnections: (platform, connections) => {
    set((state) => ({
      platforms: {
        ...state.platforms,
        [platform]: {
          ...state.platforms[platform],
          connections,
          connected: connections.length > 0,
          displayName: connections[0]?.displayName ?? null,
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
      get().setConnections(platform, status.connections ?? []);
    } catch (error) {
      console.error(`[Social Auth] refreshStatus(${platform}) failed`, error);
      set((state) => ({
        platforms: {
          ...state.platforms,
          [platform]: {
            ...state.platforms[platform],
            isChecking: false,
          },
        },
      }));
    }
  },

  refreshAll: async () => {
    const platforms: SocialPublishablePlatform[] = [
      "facebook",
      "instagram",
      "threads",
      "tiktok",
      "x",
    ];
    await Promise.all(platforms.map((p) => get().refreshStatus(p)));
  },
}));
