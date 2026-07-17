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
} from "../utils/apiClient";
import { authService } from "../../services/auth.service";
import {
  AUTH_SESSION_KEY,
  clearDesktopRefreshToken,
  getDesktopRefreshToken,
  isDesktopAuthSessionAvailable,
  setDesktopRefreshToken,
} from "../utils/desktopAuth";
import { isTauri } from "../utils/platform";
import {
  cacheAuthProfile,
  clearActiveAuthProfile,
  getCachedAuthProfile,
} from "../persistence/local-database";

let authInitializationPromise: Promise<void> | null = null;

// --- Constants ---
const clearLocalSessionData = () => {
  const allCookies = Cookies.get();
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

const resolveUserHelper = async (_token: string): Promise<User | null> => {
  setDefaultAuthHeader(_token);
  const user = await authService.status();
  await cacheAuthProfile(user);
  return user;
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
  const lostTokenUnexpectedly = !hasToken && hadToken;
  const isInconsistentState =
    sessionMode !== "offline" && !hasToken && (isAuthenticated || !!user);

  if (lostTokenUnexpectedly || isInconsistentState) {
    useAuthStore.getState().logout();
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
      await safeServerLogout();
      await clearActiveAuthProfile();
      clearLocalSessionData();
      sessionStorage.removeItem("subscription_intent_token");
    },

    finalizeLogout: () => {
      setIsLoggingOut(false);
      resetStore();
    },

    refreshTokens: async () => {
      try {
        const refreshResponse =
          isTauri() && isDesktopAuthSessionAvailable()
            ? await authService.refreshDesktop(getDesktopRefreshToken()!)
            : await authService.refresh();

        const { token, refreshToken } = refreshResponse;
        if (isTauri()) {
          setDesktopRefreshToken(refreshToken);
        }
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
          get().logout();
        }
        throw error;
      }
    },

    checkAuthStatus: async () => {
      set({ isLoading: true });
      try {
        const refreshResponse =
          isTauri() && isDesktopAuthSessionAvailable()
            ? await authService.refreshDesktop(getDesktopRefreshToken()!)
            : await authService.refresh();
        const { token, refreshToken } = refreshResponse;
        if (isTauri()) {
          setDesktopRefreshToken(refreshToken);
        }
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
          get().logout();
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
        set({ isLoading: false });
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
              .checkAuthStatus()
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
      void cacheAuthProfile(updated);
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
      void cacheAuthProfile(user);
    },
  };
});

// --- Init Subscription ---
useAuthStore.subscribe(handleStoreSubscription);

// --- Init Callback ---
setTokenRefreshCallback(async (token: string) => {
  if (useAuthStore.getState().isLoggingOut) {
    return;
  }
  const user = await resolveUserHelper(token);
  if (useAuthStore.getState().isLoggingOut) {
    return;
  }
  useAuthStore.setState({
    token,
    user,
    isAuthenticated: !!user,
    sessionMode: user ? "online" : null,
  });
});

// --- Session Expired Callback ---
setSessionExpiredCallback(() => {
  void useAuthStore
    .getState()
    .logout()
    .then(() => {
      useAuthStore.getState().finalizeLogout();
    });
});

setActiveSessionChecker(() => {
  const { token, isAuthenticated } = useAuthStore.getState();
  return !!token || isAuthenticated;
});
