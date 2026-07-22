const AUTH_RETURN_PATH_KEY = "open-clipper-auth-return-path";

export function isSafeInternalReturnPath(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      !value.toLowerCase().includes("javascript:"),
  );
}

export function rememberAuthReturnPath(path: string): void {
  if (isSafeInternalReturnPath(path)) {
    sessionStorage.setItem(AUTH_RETURN_PATH_KEY, path);
  }
}

export function consumeAuthReturnPath(fallback = "/clipper"): string {
  const stored = sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
  sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  return isSafeInternalReturnPath(stored) ? stored : fallback;
}
