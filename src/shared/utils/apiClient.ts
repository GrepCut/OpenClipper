import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  type AxiosRequestConfig,
} from "axios";
import {
  AUTH_SESSION_KEY,
  clearDesktopRefreshToken,
  getDesktopRefreshToken,
  setDesktopRefreshToken,
} from "./desktopAuth";
import {
  canAttemptAuthRefresh,
  isJwtExpiredOrExpiringSoon,
  shouldForceLogoutOnUnauthorized,
  shouldRefreshOnUnauthorized,
} from "./apiClient.auth.util";
import { isTauri } from "./platform";
import { appToast } from "./toast.service";

function appRoute(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = import.meta.env.BASE_URL;
  if (base && base.startsWith("/") && base !== "/") {
    return base.replace(/\/$/, "") + p;
  }
  return p;
}

// --- Constants ---
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const AUTH_REFRESH_URL = "/auth/refresh";
const DESKTOP_REFRESH_URL = "/auth/desktop/refresh";
// Krótkie requesty JSON sesji dostają własny limit — globalny timeout: 0 musi
// zostać (uploady), ale odświeżanie sesji nie może wisieć do timeoutu TCP (~21s).
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const LOGIN_ROUTE = appRoute("/auth");
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const USAGE_LIMIT_EVENT = "grepcut:usage-limit";
const ACCOUNT_BANNED_EVENT = "grepcut:account-banned";

export interface ApiErrorData {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

interface RetryQueueItem {
  resolve: (value: string | PromiseLike<string>) => void;
  reject: (reason: Error) => void;
}

export interface ApiRequestConfig<D = any> extends AxiosRequestConfig<D> {
  _retry?: boolean;
  _skipAuthRefresh?: boolean;
}

interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _skipAuthRefresh?: boolean;
}

// --- State ---
let isRefreshing = false;
let isLoggingOut = false;
let failedQueue: RetryQueueItem[] = [];
let lastNetworkErrorToastAt = 0;
const NETWORK_ERROR_TOAST_THROTTLE_MS = 10_000;

export const setIsLoggingOut = (value: boolean) => {
  isLoggingOut = value;
};

// --- Queue Management ---
const processQueue = (error: Error | null, token?: string): void => {
  failedQueue.forEach((item) => {
    if (error) {
      item.reject(error);
    } else {
      item.resolve(token ?? "");
    }
  });
  failedQueue = [];
};

const addToQueue = (): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    failedQueue.push({ resolve, reject });
  });
};

// --- API Client Initialization ---
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 0,
  withCredentials: true,
});

// --- Utilities ---
const getBearerToken = (token: string): string => {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
};

const getDefaultAuthHeader = (): string | null => {
  const value = apiClient.defaults.headers.common["Authorization"];
  return value ? String(value) : null;
};

export const setDefaultAuthHeader = (
  tokenOrHeader: string | null | undefined,
): void => {
  const commonHeaders = apiClient.defaults.headers.common as Record<
    string,
    string | number | boolean | null | undefined
  >;

  if (!tokenOrHeader) {
    delete commonHeaders["Authorization"];
    delete commonHeaders["authorization"];
    return;
  }

  const headerValue = getBearerToken(tokenOrHeader);
  commonHeaders["Authorization"] = headerValue;
};

const setRequestAuthHeader = (
  config: InternalAxiosRequestConfig,
  headerValue: string,
): void => {
  const headers = AxiosHeaders.from(config.headers ?? {});
  headers.set("Authorization", headerValue);
  config.headers = headers;
};

const isNetworkError = (error: unknown): boolean =>
  error instanceof AxiosError && !error.response;

const hasSessionMarker = (): boolean =>
  typeof localStorage !== "undefined" &&
  !!localStorage.getItem(AUTH_SESSION_KEY);

const syncDesktopSessionMarker = (): void => {
  if (isTauri() && getDesktopRefreshToken()) {
    localStorage.setItem(AUTH_SESSION_KEY, "true");
  }
};

const canAttemptRefresh = (): boolean =>
  canAttemptAuthRefresh({
    isTauri: isTauri(),
    hasDesktopRefreshToken: !!getDesktopRefreshToken(),
    hasSessionMarker: hasSessionMarker(),
  });

const showNetworkErrorToast = (): void => {
  const now = Date.now();
  if (now - lastNetworkErrorToastAt < NETWORK_ERROR_TOAST_THROTTLE_MS) return;
  lastNetworkErrorToastAt = now;
  appToast.warning(
    "No connection to server",
    "Check your internet connection. Your session remains active.",
    { duration: 8000 },
  );
};

export const extractApiErrorMessage = (
  error: unknown,
  fallback = "Request failed",
): string => {
  if (axios.isAxiosError(error)) {
    return extractErrorMessage(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const extractErrorMessage = (error: AxiosError<ApiErrorData>): string => {
  const errorData = error.response?.data;
  if (!errorData) return error.message;

  if (typeof errorData.message === "string") return errorData.message;
  if (Array.isArray(errorData.message)) return errorData.message.join(", ");

  return errorData.error || error.message;
};

const forceLogout = (): void => {
  setDefaultAuthHeader(null);
  localStorage.removeItem(AUTH_SESSION_KEY);
  clearDesktopRefreshToken();
  if (onSessionExpired) {
    onSessionExpired();
  } else {
    window.location.href = LOGIN_ROUTE;
  }
};

// --- Callbacks ---
let onTokenRefreshed: ((token: string) => void) | null = null;
let onSessionExpired: (() => void) | null = null;
let hasActiveStoreSession: (() => boolean) | null = null;

export const setTokenRefreshCallback = (cb: (token: string) => void) => {
  onTokenRefreshed = cb;
};

export const setSessionExpiredCallback = (cb: () => void) => {
  onSessionExpired = cb;
};

export const setActiveSessionChecker = (cb: () => boolean) => {
  hasActiveStoreSession = cb;
};

// --- Handlers ---
export const refreshAuthToken = async (): Promise<string> => {
  if (isRefreshing) {
    return addToQueue();
  }

  isRefreshing = true;

  try {
    // In Tauri without a stored desktop token, fall back to the cookie-based
    // refresh; its response re-seeds the desktop token below.
    const desktopRefreshToken = isTauri() ? getDesktopRefreshToken() : null;
    const isDesktopRefresh = !!desktopRefreshToken;

    if (isDesktopRefresh) {
      syncDesktopSessionMarker();
    }

    const refreshUrl = isDesktopRefresh
      ? DESKTOP_REFRESH_URL
      : AUTH_REFRESH_URL;
    const refreshBody = isDesktopRefresh
      ? { refreshToken: desktopRefreshToken }
      : {};

    const response = await apiClient.post<{
      token: string;
      refreshToken?: string;
    }>(refreshUrl, refreshBody, {
      _skipAuthRefresh: true,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    } as ApiRequestConfig);
    const responseData = response.data as {
      token: string;
      refreshToken?: string;
    };
    const newToken = responseData.token;
    if (isTauri() && responseData.refreshToken) {
      setDesktopRefreshToken(responseData.refreshToken);
      syncDesktopSessionMarker();
    }
    setDefaultAuthHeader(newToken);
    if (import.meta.env.DEV) {
      console.debug("[ApiClient] auth_refresh succeeded");
    }
    if (onTokenRefreshed) {
      onTokenRefreshed(newToken);
    }
    processQueue(null, newToken);
    return newToken;
  } catch (refreshError) {
    processQueue(refreshError as Error);
    if (isNetworkError(refreshError)) {
      showNetworkErrorToast();
    } else {
      forceLogout();
    }
    throw refreshError;
  } finally {
    isRefreshing = false;
  }
};

const retryWithFreshToken = async (
  originalRequest: ExtendedAxiosRequestConfig,
): Promise<AxiosResponse> => {
  try {
    const freshToken = await refreshAuthToken();

    setRequestAuthHeader(originalRequest, getBearerToken(freshToken));

    return apiClient(originalRequest);
  } catch (error) {
    console.error("[ApiClient] Refresh failed or retry failed:", error);
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    return Promise.reject(normalizedError);
  }
};

const handleApiError = async (
  error: AxiosError<ApiErrorData>,
): Promise<AxiosResponse> => {
  const originalRequest = error.config as
    | ExtendedAxiosRequestConfig
    | undefined;
  const status = error.response?.status;
  const isUnauthorized = status === HTTP_STATUS_UNAUTHORIZED;
  const isForbidden = status === HTTP_STATUS_FORBIDDEN;
  const isRefreshRequest =
    originalRequest?.url?.includes(AUTH_REFRESH_URL) ||
    originalRequest?.url?.includes(DESKTOP_REFRESH_URL);

  if (isUnauthorized && isTauri() && getDesktopRefreshToken()) {
    syncDesktopSessionMarker();
  }

  const canRefresh = canAttemptRefresh();
  const hasAuthHeader = !!getDefaultAuthHeader();
  const shouldAttemptRefresh = shouldRefreshOnUnauthorized({
    isUnauthorized,
    isRetry: !!originalRequest?._retry,
    isRefreshRequest: !!isRefreshRequest,
    canAttemptRefresh: canRefresh,
  });

  if (originalRequest?._skipAuthRefresh || isLoggingOut) {
    return Promise.reject(error);
  }

  if (isNetworkError(error)) {
    showNetworkErrorToast();
    return Promise.reject(error);
  }

  if (status === 402) {
    window.dispatchEvent(
      new CustomEvent(USAGE_LIMIT_EVENT, { detail: error.response?.data }),
    );
    return Promise.reject(error);
  }

  if (isForbidden) {
    const message = extractErrorMessage(error);
    if (message.includes("ACCOUNT_BANNED")) {
      window.dispatchEvent(
        new CustomEvent(ACCOUNT_BANNED_EVENT, { detail: error.response?.data }),
      );
    }
    return Promise.reject(error);
  }

  if (isUnauthorized && isRefreshRequest) {
    console.error("[ApiClient] Refresh token failed (401). Forcing logout.");
    forceLogout();
    return Promise.reject(error);
  }

  if (shouldAttemptRefresh && originalRequest) {
    if (import.meta.env.DEV) {
      console.debug("[ApiClient] 401_retry", originalRequest.url ?? "");
    }
    originalRequest._retry = true;
    return retryWithFreshToken(originalRequest);
  }

  if (
    shouldForceLogoutOnUnauthorized({
      isUnauthorized,
      isRefreshRequest: !!isRefreshRequest,
      canAttemptRefresh: canRefresh,
      hasAuthHeader,
      hasActiveStoreSession: hasActiveStoreSession?.() ?? false,
    })
  ) {
    console.warn(
      "[ApiClient] Session cannot be refreshed. Forcing logout.",
    );
    forceLogout();
    return Promise.reject(error);
  }

  if (isUnauthorized && !isRefreshRequest) {
    console.warn(
      "[ApiClient] Unauthorized without an established session. Leaving route unchanged.",
      {
        isTauri: isTauri(),
        hasDesktopRefreshToken: !!getDesktopRefreshToken(),
        hasSessionMarker: hasSessionMarker(),
        isRetry: !!originalRequest?._retry,
      },
    );
  }

  return Promise.reject(error);
};

// --- Interceptors ---
apiClient.interceptors.request.use(async (config) => {
  const extendedConfig = config as ExtendedAxiosRequestConfig;
  const isSessionRefresh =
    extendedConfig.url?.includes(AUTH_REFRESH_URL) ||
    extendedConfig.url?.includes(DESKTOP_REFRESH_URL);

  if (isSessionRefresh) {
    if (config.headers) {
      delete config.headers["Authorization"];
      delete config.headers["authorization"];
    }
    return config;
  }

  const authHeader = getDefaultAuthHeader();
  if (authHeader) {
    const rawToken = authHeader.replace(/^Bearer\s+/i, "");
    if (
      isJwtExpiredOrExpiringSoon(rawToken) &&
      canAttemptRefresh() &&
      !isLoggingOut
    ) {
      try {
        const freshToken = await refreshAuthToken();
        setRequestAuthHeader(config, getBearerToken(freshToken));
        return config;
      } catch {
        setRequestAuthHeader(config, authHeader);
        return config;
      }
    }

    setRequestAuthHeader(config, authHeader);
  }

  return config;
});

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  handleApiError,
);
