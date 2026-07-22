import type { NavigateFunction } from "react-router-dom";
import { authService } from "../../services/auth.service";
import { extractApiErrorMessage } from "../../shared/utils/api-client.util";
import { appToast } from "../../shared/utils/toast.service";
import {
  hasDesktopTicketBeenExchanged,
  markDesktopTicketAsExchanged,
} from "../../shared/utils/desktop-auth.util";
import type { User } from "../../shared/types/auth.types";

export type OAuthConnectionStatus = "connecting" | "verifying" | "success" | "error";

export interface OAuthSearchParams {
  ticket: string | null;
  error: string | null;
  returnPath: string | null;
}

export interface DesktopLoginActions {
  completeDesktopLogin: (payload: {
    token: string;
    refreshToken: string;
    user: User;
  }) => void;
  checkAuthStatus: () => Promise<void>;
}

export function parseOAuthSearchParams(search: string): OAuthSearchParams {
  const params = new URLSearchParams(search);
  return {
    ticket: params.get("ticket"),
    error: params.get("error"),
    returnPath: params.get("returnPath"),
  };
}

export async function exchangeDesktopTicketIfNeeded(
  ticket: string,
  actions: DesktopLoginActions,
  onAlreadyExchanged?: () => void,
): Promise<void> {
  if (hasDesktopTicketBeenExchanged(ticket)) {
    onAlreadyExchanged?.();
    return;
  }

  const response = await authService.exchangeDesktopTicket(ticket);
  markDesktopTicketAsExchanged(ticket);
  actions.completeDesktopLogin({
    token: response.token,
    refreshToken: response.refreshToken,
    user: response.user,
  });
  await actions.checkAuthStatus();
}

export function resolveOAuthReturnPath(
  returnPathFromQuery: string | null | undefined,
  search: string,
  fallback = "/clipper",
): string {
  const params = new URLSearchParams(search);
  return returnPathFromQuery || params.get("returnPath") || fallback;
}

export function handleOAuthConnectionSuccess(
  navigate: NavigateFunction,
  target: string,
  toastMessage: string,
  onStatusChange: (status: OAuthConnectionStatus) => void,
): void {
  onStatusChange("success");
  appToast.success("Success", toastMessage);
  setTimeout(() => navigate(target, { replace: true }), 1500);
}

export function handleOAuthConnectionFailure(
  navigate: NavigateFunction,
  error: unknown,
  fallbackMessage: string,
  redirectPath: string,
  onStatusChange: (status: OAuthConnectionStatus) => void,
  onErrorMessage: (message: string) => void,
): void {
  onStatusChange("error");
  const errorMsg = extractApiErrorMessage(error, fallbackMessage);
  onErrorMessage(errorMsg);
  appToast.error("Connection Failed", errorMsg, { duration: 5000 });
  setTimeout(() => navigate(redirectPath, { replace: true }), 3000);
}
