import { beforeEach, describe, expect, it, vi } from "vitest";

const authRefreshMock = vi.hoisted(() => vi.fn());
const authStatusMock = vi.hoisted(() => vi.fn());
const cacheAuthProfileMock = vi.hoisted(() => vi.fn());
const getCachedAuthProfileMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../services/auth.service", () => ({
  authService: {
    refresh: authRefreshMock,
    refreshDesktop: vi.fn(),
    status: authStatusMock,
    logout: vi.fn(),
  },
}));
vi.mock("../utils/platform", () => ({ isTauri: isTauriMock }));
vi.mock("../utils/desktopAuth", () => ({
  AUTH_SESSION_KEY: "auth_session",
  clearDesktopRefreshToken: vi.fn(),
  getDesktopRefreshToken: vi.fn(),
  isDesktopAuthSessionAvailable: () => false,
  setDesktopRefreshToken: vi.fn(),
}));
vi.mock("../persistence/local-database", () => ({
  cacheAuthProfile: cacheAuthProfileMock,
  clearActiveAuthProfile: vi.fn(),
  getCachedAuthProfile: getCachedAuthProfileMock,
}));

import { useAuthStore } from "./useAuthStore";

const originalLogout = useAuthStore.getState().logout;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("ensureAuthLoaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    vi.stubGlobal("localStorage", new MemoryStorage());
    localStorage.setItem("auth_session", "true");
    useAuthStore.setState({ isLoggingOut: true });
    useAuthStore.setState({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
      hasTriedInit: false,
      isLoggingOut: false,
      sessionMode: null,
      logout: originalLogout,
    });
  });

  it("shares the in-flight initialization between concurrent callers", async () => {
    let resolveRefresh!: (value: { token: string; refreshToken: string }) => void;
    authRefreshMock.mockImplementation(
      () =>
        new Promise<{ token: string; refreshToken: string }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    authStatusMock.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    cacheAuthProfileMock.mockResolvedValue(undefined);

    const first = useAuthStore.getState().ensureAuthLoaded();
    const second = useAuthStore.getState().ensureAuthLoaded();

    expect(authRefreshMock).toHaveBeenCalledTimes(1);
    resolveRefresh({ token: "token", refreshToken: "refresh" });
    await Promise.all([first, second]);

    expect(authStatusMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().hasTriedInit).toBe(true);
  });
});

describe("ensureAuthLoaded (desktop stale-while-revalidate)", () => {
  const cachedUser = { id: "user-1", email: "user@example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("localStorage", new MemoryStorage());
    localStorage.setItem("auth_session", "true");
    useAuthStore.setState({ isLoggingOut: true });
    useAuthStore.setState({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
      hasTriedInit: false,
      isLoggingOut: false,
      sessionMode: null,
      logout: originalLogout,
    });
  });

  it("activates the cached offline session before revalidation settles", async () => {
    getCachedAuthProfileMock.mockResolvedValue(cachedUser);
    // Rewalidacja nigdy się nie kończy — init i tak musi się rozstrzygnąć.
    authRefreshMock.mockImplementation(() => new Promise(() => {}));

    await useAuthStore.getState().ensureAuthLoaded();

    const state = useAuthStore.getState();
    expect(state.hasTriedInit).toBe(true);
    expect(state.user).toEqual(cachedUser);
    expect(state.isAuthenticated).toBe(true);
    expect(state.sessionMode).toBe("offline");
    expect(state.token).toBeNull();
  });

  it("flips to online when background revalidation succeeds", async () => {
    getCachedAuthProfileMock.mockResolvedValue(cachedUser);
    authRefreshMock.mockResolvedValue({
      token: "token-1",
      refreshToken: "refresh-1",
    });
    authStatusMock.mockResolvedValue(cachedUser);
    cacheAuthProfileMock.mockResolvedValue(undefined);

    await useAuthStore.getState().ensureAuthLoaded();

    await vi.waitFor(() => {
      expect(useAuthStore.getState().sessionMode).toBe("online");
    });
    expect(useAuthStore.getState().token).toBe("token-1");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("logs out when background revalidation is rejected with 401", async () => {
    getCachedAuthProfileMock.mockResolvedValue(cachedUser);
    authRefreshMock.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), {
        isAxiosError: true,
        response: { status: 401 },
      }),
    );
    const logoutMock = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout: logoutMock });

    await useAuthStore.getState().ensureAuthLoaded();

    await vi.waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
    });
  });

  it("keeps the cached offline session when revalidation fails with a network error", async () => {
    getCachedAuthProfileMock.mockResolvedValue(cachedUser);
    authRefreshMock.mockRejectedValue(new Error("Network Error"));

    await useAuthStore.getState().ensureAuthLoaded();

    // Fallback offline w checkAuthStatus czyta cache ponownie — czekamy,
    // aż rewalidacja w tle się rozstrzygnie.
    await vi.waitFor(() => {
      expect(getCachedAuthProfileMock).toHaveBeenCalledTimes(2);
    });
    const state = useAuthStore.getState();
    expect(state.sessionMode).toBe("offline");
    expect(state.user).toEqual(cachedUser);
    expect(state.isAuthenticated).toBe(true);
  });
});
