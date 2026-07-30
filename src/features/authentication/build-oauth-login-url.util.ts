import { API_BASE_URL } from "../../shared/utils/api-client.util";
import { useAuthStore } from "../../shared/stores/use-auth-store.store";
import { getAuthClient } from "../../shared/utils/auth-client.util";

type OAuthLoginPath = "/auth/google/youtube/login";

export function buildOAuthLoginUrl(path: OAuthLoginPath, returnPath?: string): string {
  const loginHint = useAuthStore.getState().user?.email?.trim();
  const client = getAuthClient();

  const params = new URLSearchParams();
  params.append("client", client);
  if (loginHint) params.append("login_hint", loginHint);
  if (returnPath) params.append("returnPath", returnPath);

  return `${API_BASE_URL}${path}?${params.toString()}`;
}
