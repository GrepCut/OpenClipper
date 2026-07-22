import { buildOAuthLoginUrl } from "../features/authentication/build-oauth-login-url.util";
import { apiClient } from "../shared/utils/api-client.util";
import { openExternalAuthUrl } from "../shared/utils/desktop-auth.util";
export * from "./types/google-auth.types";
import type {
  GoogleDriveTokenResponse,
  GoogleDriveStatusResponse,
  GetAccessTokenResponse,
} from "./types/google-auth.types";

export const googleAuthService = {
  async redirectToDriveConnect(returnPath?: string): Promise<void> {
    const redirectUrl = buildOAuthLoginUrl("/auth/google/drive/login", returnPath);
    await openExternalAuthUrl(redirectUrl);
  },
  async getAccessToken(): Promise<GetAccessTokenResponse> {
    try {
      const response = await apiClient
        .get<GoogleDriveTokenResponse>("/auth/google/drive/token")
        .then((res) => res.data);
      return { success: true, data: response };
    } catch (error) {
      return { success: false };
    }
  },

  async checkDriveConnection(): Promise<boolean> {
    try {
      const response = await apiClient
        .get<GoogleDriveStatusResponse>("/auth/google/drive/status")
        .then((res) => res.data);
      return response.connected;
    } catch (error) {
      return false;
    }
  },
};
