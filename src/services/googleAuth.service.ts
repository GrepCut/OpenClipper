import { apiClient } from "../shared/utils/apiClient";
export * from "./types/googleAuth.types";
import type {
  GoogleDriveTokenResponse,
  GoogleDriveStatusResponse,
  GetAccessTokenResponse,
} from "./types/googleAuth.types";

export const googleAuthService = {
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
