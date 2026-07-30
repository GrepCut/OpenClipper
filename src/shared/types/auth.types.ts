import { SubscriptionTier } from "./subscription-tier.types";
import { UserRole } from "./user-role.types";

export type { SubscriptionTier };
export { UserRole };

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  provider: string;
  status: string;
  socialId: string | null;
  picture: string | null;
  role: UserRole;
  subscriptionTier: SubscriptionTier;
  isBanned: boolean;
  banReason?: string | null;
  bannedAt?: string | null;
  selectedLlmProvider: string | null;
  selectedClassificationVisionModelId: string | null;
  selectedClassificationSummarizerModelId: string | null;
  selectedEmbeddingModelId: string | null;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthCoreState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasTriedInit: boolean;
  isLoggingOut: boolean;
  sessionMode: "online" | "offline" | null;
}

export interface AuthActions {
  logout: () => Promise<void>;
  finalizeLogout: () => void;
  refreshTokens: () => Promise<string>;
  checkAuthStatus: (options?: { silent?: boolean }) => Promise<void>;
  ensureAuthLoaded: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
  completeDesktopLogin: (payload: {
    token: string;
    refreshToken: string;
    user: User;
  }) => void;
}

export type AuthState = AuthCoreState & AuthActions;
