import { useAuthStore } from "../stores/use-auth-store.store";

export type AccountState = "checking" | "guest" | "authenticated";

export class AccountRequiredError extends Error {
  readonly code = "ACCOUNT_REQUIRED";

  constructor(message = "Log in to use this account feature.") {
    super(message);
    this.name = "AccountRequiredError";
  }
}

export function accountState(): AccountState {
  const { hasTriedInit, isLoading, isLoggingOut, user, isAuthenticated } =
    useAuthStore.getState();
  if (!hasTriedInit || isLoading || isLoggingOut) return "checking";
  return user && isAuthenticated ? "authenticated" : "guest";
}

export function hasOnlineAccountAccess(): boolean {
  const { user, token, isAuthenticated, sessionMode } = useAuthStore.getState();
  return Boolean(user && token && isAuthenticated && sessionMode === "online");
}

export function requireOnlineAccount(): void {
  if (!hasOnlineAccountAccess()) throw new AccountRequiredError();
}
