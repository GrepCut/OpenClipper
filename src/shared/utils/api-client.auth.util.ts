const JWT_EXPIRY_BUFFER_SECONDS = 30;

export function isJwtExpiredOrExpiringSoon(
  token: string,
  nowSec = Date.now() / 1000,
  bufferSec = JWT_EXPIRY_BUFFER_SECONDS,
): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return (
      typeof payload.exp === "number" &&
      nowSec > payload.exp - bufferSec
    );
  } catch {
    return true;
  }
}

export function canAttemptAuthRefresh(options: {
  isTauri: boolean;
  hasDesktopRefreshToken: boolean;
  hasSessionMarker: boolean;
}): boolean {
  if (options.isTauri) {
    // Desktop token is preferred, but a session marker alone still allows a
    // cookie-based refresh attempt (which re-seeds the desktop token on success).
    return options.hasDesktopRefreshToken || options.hasSessionMarker;
  }

  return options.hasSessionMarker;
}

export function shouldRefreshOnUnauthorized(options: {
  isUnauthorized: boolean;
  isRetry: boolean;
  isRefreshRequest: boolean;
  canAttemptRefresh: boolean;
}): boolean {
  return (
    options.isUnauthorized &&
    !options.isRetry &&
    !options.isRefreshRequest &&
    options.canAttemptRefresh
  );
}

export function shouldForceLogoutOnUnauthorized(options: {
  isUnauthorized: boolean;
  isRefreshRequest: boolean;
  canAttemptRefresh: boolean;
  hasAuthHeader: boolean;
  hasActiveStoreSession: boolean;
}): boolean {
  if (
    !options.isUnauthorized ||
    options.isRefreshRequest ||
    options.canAttemptRefresh
  ) {
    return false;
  }

  return options.hasAuthHeader || options.hasActiveStoreSession;
}
