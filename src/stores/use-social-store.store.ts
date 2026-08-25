import { create } from "zustand";
import { socialAuthService } from "../services/social-auth.service";
import type {
  SocialConnectionSummary,
  SocialPublishablePlatform,
  SocialStatusResponse,
} from "../services/types/social-auth.types";

const SOCIAL_STATUS_PLATFORMS: SocialPublishablePlatform[] = [
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "x",
];

type PlatformState = {
  connections: SocialConnectionSummary[];
  connected: boolean;
  displayName: string | null;
  isChecking: boolean;
};

type SocialStore = {
  platforms: Record<SocialPublishablePlatform, PlatformState>;
  /** Single-platform refresh, for reconnect flows. Whole-app hydration goes through
   *  `refreshAllIntegrations()`, which also hydrates the YouTube store. */
  refreshStatus: (platform: SocialPublishablePlatform) => Promise<void>;
  beginCheckAll: () => void;
  endCheckAll: () => void;
  applyAll: (
    platforms: Record<SocialPublishablePlatform, SocialStatusResponse>,
  ) => void;
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

function statusToPlatformState(status: SocialStatusResponse): PlatformState {
  const connections = status.connections ?? [];
  return {
    connections,
    connected: connections.length > 0,
    displayName: connections[0]?.displayName ?? null,
    isChecking: false,
  };
}

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

  beginCheckAll: () => {
    set((state) => {
      const platforms = { ...state.platforms };
      for (const platform of SOCIAL_STATUS_PLATFORMS) {
        platforms[platform] = { ...platforms[platform], isChecking: true };
      }
      return { platforms };
    });
  },

  endCheckAll: () => {
    set((state) => {
      const platforms = { ...state.platforms };
      for (const platform of SOCIAL_STATUS_PLATFORMS) {
        platforms[platform] = { ...platforms[platform], isChecking: false };
      }
      return { platforms };
    });
  },

  applyAll: (payload) => {
    set((state) => {
      const platforms = { ...state.platforms };
      for (const platform of SOCIAL_STATUS_PLATFORMS) {
        const status = payload[platform];
        if (!status) continue;
        platforms[platform] = statusToPlatformState(status);
      }
      return { platforms };
    });
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
}));
