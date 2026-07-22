import {
  apiClient,
  API_BASE_URL,
  AUTH_REQUEST_TIMEOUT_MS,
  type ApiRequestConfig,
} from "../shared/utils/api-client.util";
import type { User } from "../shared/types/auth.types";
export * from "./types/auth.types";
import type { LoginResponse, RefreshResponse } from "./types/auth.types";
import { getAuthClient } from "../shared/utils/auth-client.util";
import { openExternalAuthUrl } from "../shared/utils/desktop-auth.util";

export const authService = {
  logout: (options?: { disconnectGoogleDrive?: boolean }) =>
    apiClient
      .post<void>("/auth/logout", {}, { params: options })
      .then((res) => res.data),
  refresh: () =>
    apiClient
      .post<RefreshResponse>("/auth/refresh", {}, {
        timeout: AUTH_REQUEST_TIMEOUT_MS,
      })
      .then((res) => res.data as RefreshResponse),
  refreshDesktop: (refreshToken: string) =>
    apiClient
      .post<RefreshResponse>(
        "/auth/desktop/refresh",
        { refreshToken },
        {
          _skipAuthRefresh: true,
          timeout: AUTH_REQUEST_TIMEOUT_MS,
        } as ApiRequestConfig,
      )
      .then((res) => res.data as RefreshResponse),
  status: () =>
    apiClient
      .get<User>("/auth/status", { timeout: AUTH_REQUEST_TIMEOUT_MS })
      .then((res) => res.data),
  exchangeDesktopTicket: (ticket: string) =>
    apiClient
      .post<LoginResponse>(
        "/auth/desktop/exchange",
        { ticket },
        { _skipAuthRefresh: true } as ApiRequestConfig,
      )
      .then((res) => res.data as LoginResponse),
  beginGoogleLogin: async (intentToken?: string) => {
    let url = `${API_BASE_URL}/auth/google/login?client=${getAuthClient()}`;
    
    if (intentToken) {
      url += `&intent=${intentToken}`;
    }
    
    await openExternalAuthUrl(url);
  },
};
