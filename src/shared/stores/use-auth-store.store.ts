import { create } from "zustand";
import { isAxiosError } from "axios";
import Cookies from "js-cookie";
import type { AuthState, User } from "../types/auth.types";
import {
  setActiveSessionChecker,
  setDefaultAuthHeader,
  setIsLoggingOut,
  setTokenRefreshCallback,
  setSessionExpiredCallback,
  refreshAuthToken,
} from "../utils/api-client.util";
import { authService } from "../../services/auth.service";
import {
  AUTH_SESSION_KEY,
  clearDesktopRefreshToken,
  isDesktopAuthSessionAvailable,
  setDesktopRefreshToken,
} from "../utils/desktop-auth.util";
import { isTauri } from "../utils/platform.util";
import {
  cacheAuthProfile,
  clearActiveAuthProfile,
  getCachedAuthProfile,
} from "../persistence/local-database.util";
import { reportClipperPersistenceError } from "../../features/clipper/persistence/persistence-error.util";

let authInitializationPromise: Promise<void> | null = null;

// --- Constants ---
const clearLocalSessionData = () => {
  const allCookies = Cookies.get() ?? {};
  Object.keys(allCookies).forEach((key) => {
    Cookies.remove(key);
    Cookies.remove(key, { path: "/" });
  });
  localStorage.removeItem(AUTH_SESSION_KEY);
  clearDesktopRefreshToken();
  setDefaultAuthHeader(null);
};

// Only a definitive rejection of our credentials should destroy the session.
// Network errors / 5xx are transient — wiping the desktop refresh token on
// those permanently logs desktop users out.
const isAuthRejection = (error: unknown): boolean =>
  isAxiosError(error) &&
  (error.response?.status === 401 || error.response?.status === 403);

const safeServerLogout = async () => {
  try {
    await authService.logout({ disconnectGoogleDrive: true });
  } catch {
    // Best-effort cleanup
  }
};

let profileRequest: { token: string; promise: Promise<User> } | null = null;
const resolveUserHelper = (token: string): Promise<User> => {
  if (profileRequest?.token === token) return profileRequest.promise;
  setDefaultAuthHeader(token);
  const promise = authService.status().then(async (user) => {
    await cacheAuthProfile(user);
    return user;
  }).finally(() => {
    if (profileRequest?.promise === promise) profileRequest = null;
  });
  profileRequest = { token, promise };
  return promise;
};

// --- Subscriptions Logic ---

const handleStoreSubscription = (state: AuthState, prevState: AuthState) => {
  const { token, isAuthenticated, user, sessionMode } = state;
  const { token: prevToken, isLoggingOut: wasLoggingOut } = prevState;

  // Sync Token to API Client
  if (token !== prevToken) {
    setDefaultAuthHeader(token);
  }

  // Intentional logout — token removal is expected, skip inconsistency detection
  if (wasLoggingOut) {
    return;
  }

  // Detect Inconsistent State
  const hasToken = !!token;
  const hadToken = !!prevToken;
  const lostTokenUnexpectedly = sessionMode !== "offline" && !hasToken && hadToken;
  const isInconsistentState =
    sessionMode !== "offline" && !hasToken && (isAuthenticated || !!user);

  if (lostTokenUnexpectedly || isInconsistentState) {
    void useAuthStore.getState().logout().catch(reportClipperPersistenceError);
  }
};

// --- Store ---

export const useAuthStore = create<AuthState>((set, get) => {
  const resetStore = () => {
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      hasTriedInit: true,
      isLoading: false,
      isLoggingOut: false,
      sessionMode: null,
    });
  };

  const resolveUser = resolveUserHelper;

  const syncSessionMarker = (isAuthenticated: boolean) => {
    if (isAuthenticated) {
      localStorage.setItem(AUTH_SESSION_KEY, "true");
      return;
    }

    localStorage.removeItem(AUTH_SESSION_KEY);
  };

  return {
    user: null,
    token: null,
    isLoading: false,
    isAuthenticated: false,
    hasTriedInit: false,
    isLoggingOut: false,
    sessionMode: null,

    logout: async () => {
      set({ isLoggingOut: true });
      setIsLoggingOut(true);
      try {
        await safeServerLogout();
        await clearActiveAuthProfile();
        clearLocalSessionData();
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("subscription_intent_token");
        }
      } finally {
        get().finalizeLogout();
      }
    },

    finalizeLogout: () => {
      setIsLoggingOut(false);
      resetStore();
    },

    refreshTokens: async () => {
      try {
        const token = await refreshAuthToken();
        set({ token, sessionMode: "online" });
        const user = await resolveUser(token);
        set({
          user,
          isAuthenticated: !!user,
          sessionMode: user ? "online" : null,
        });
        syncSessionMarker(!!user);
        return token;
      } catch (error) {
        if (isAuthRejection(error)) {
          await get().logout();
        }
        throw error;
      }
    },

    checkAuthStatus: async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) {
        set({ isLoading: true });
      }
      try {
        const token = await refreshAuthToken();
        const user = await resolveUser(token);

        set({
          user,
          token,
          isAuthenticated: !!user,
          sessionMode: user ? "online" : null,
        });
        syncSessionMarker(!!user);
      } catch (error) {
        if (isAuthRejection(error)) {
          await get().logout();
          throw error;
        }
        const cachedUser = await getCachedAuthProfile();
        if (!cachedUser) throw error;
        set({
          user: cachedUser,
          token: null,
          isAuthenticated: true,
          sessionMode: "offline",
        });
        syncSessionMarker(true);
      } finally {
        if (!silent) {
          set({ isLoading: false });
        }
      }
    },

    ensureAuthLoaded: () => {
      const { hasTriedInit, user, isAuthenticated } = get();
      if (hasTriedInit || (user && isAuthenticated)) return Promise.resolve();
      if (authInitializationPromise) return authInitializationPromise;

      const initialize = async () => {
        let hasSessionMarker = localStorage.getItem(AUTH_SESSION_KEY);
        const hasDesktopSession = isDesktopAuthSessionAvailable();

        if (isTauri() && !hasSessionMarker && hasDesktopSession) {
          localStorage.setItem(AUTH_SESSION_KEY, "true");
          hasSessionMarker = "true";
        }

        if (!hasSessionMarker) {
          set({ hasTriedInit: true });
          return;
        }

        // Desktop fast-path (stale-while-revalidate): pokaż apkę od razu na
        // cache'owanym profilu i rewaliduj sesję w tle — bez tego start blokuje
        // się na timeoutach sieciowych, gdy backend jest nieosiągalny.
        if (isTauri()) {
          const cachedUser = await getCachedAuthProfile().catch(() => null);
          if (cachedUser) {
            // token: null + sessionMode "offline" to ten sam stan, który
            // produkuje fallback offline w checkAuthStatus — subskrypcja
            // niespójności go nie wyloguje.
            set({
              user: cachedUser,
              token: null,
              isAuthenticated: true,
              sessionMode: "offline",
              hasTriedInit: true,
            });
            syncSessionMarker(true);
            void get()
              .checkAuthStatus({ silent: true })
              .catch(() => {});
            return;
          }
        }

        try {
          await get().checkAuthStatus();
        } catch {
          // Auth failures are reflected in the store; initialization still completes.
        } finally {
          set({ hasTriedInit: true });
        }
      };

      const pending = initialize();
      authInitializationPromise = pending;
      void pending.then(
        () => {
          if (authInitializationPromise === pending) {
            authInitializationPromise = null;
          }
        },
        () => {
          if (authInitializationPromise === pending) {
            authInitializationPromise = null;
          }
        },
      );
      return pending;
    },

    updateUser: (data: Partial<User>) => {
      const { user } = get();
      if (!user) return;
      const updated = { ...user, ...data };
      set({ user: updated });
      void cacheAuthProfile(updated).catch(reportClipperPersistenceError);
    },

    completeDesktopLogin: ({ token, refreshToken, user }) => {
      setDesktopRefreshToken(refreshToken);
      syncSessionMarker(true);
      setDefaultAuthHeader(token);
      set({
        token,
        user,
        isAuthenticated: true,
        isLoading: false,
        hasTriedInit: true,
        isLoggingOut: false,
        sessionMode: "online",
      });
      void cacheAuthProfile(user).catch(reportClipperPersistenceError);
    },
  };
});

// --- Init Subscription ---
useAuthStore.subscribe(handleStoreSubscription);

// --- Init Callback ---
setTokenRefreshCallback((token: string) => {
  if (useAuthStore.getState().isLoggingOut) {
    return;
  }
  useAuthStore.setState({
    token,
    sessionMode: "online",
  });
});

// --- Session Expired Callback ---
setSessionExpiredCallback(() => {
  void useAuthStore.getState().logout().catch(reportClipperPersistenceError);
});

setActiveSessionChecker(() => {
  const { token, isAuthenticated } = useAuthStore.getState();
  return !!token || isAuthenticated;
});
