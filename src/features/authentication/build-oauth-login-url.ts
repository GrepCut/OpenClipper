import { API_BASE_URL } from "../../shared/utils/apiClient";
import { useAuthStore } from "../../shared/stores/useAuthStore";
import { getAuthClient } from "../../shared/utils/auth-client";

type OAuthLoginPath = "/auth/google/drive/login" | "/auth/google/youtube/login";

export function buildOAuthLoginUrl(path: OAuthLoginPath, returnPath?: string): string {
  const loginHint = useAuthStore.getState().user?.email?.trim();
  const client = getAuthClient();

  const params = new URLSearchParams();
  params.append("client", client);
  if (loginHint) params.append("login_hint", loginHint);
  if (returnPath) params.append("returnPath", returnPath);

  return `${API_BASE_URL}${path}?${params.toString()}`;
}
