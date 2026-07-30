import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform.util";

const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "code",
  "code_verifier",
  "client_secret",
  "authorization",
  "ticket",
]);

const enabled =
  import.meta.env.VITE_INTEGRATION_LOGS_ENABLED !== "false" &&
  import.meta.env.DEV;

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key)) {
    return value ? "[redacted]" : value;
  }

  if (key === "state" && typeof value === "string") {
    return value.length > 24 ? `${value.slice(0, 24)}…` : value;
  }

  if (key === "url" && typeof value === "string") {
    try {
      const parsed = new URL(value);
      return {
        origin: parsed.origin,
        pathname: parsed.pathname,
        redirect_uri: parsed.searchParams.get("redirect_uri"),
        client_id: parsed.searchParams.get("client_id"),
        scope: parsed.searchParams.get("scope"),
        response_type: parsed.searchParams.get("response_type"),
        code_challenge_method: parsed.searchParams.get("code_challenge_method"),
        has_code_challenge: parsed.searchParams.has("code_challenge"),
        state_prefix: parsed.searchParams.get("state")?.slice(0, 24) ?? null,
      };
    } catch {
      return value;
    }
  }

  if (value && typeof value === "object") {
    return sanitizeRecord(value as Record<string, unknown>);
  }

  return value;
}

function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

export function logIntegration(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!enabled) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    source: "open-clipper",
    event,
    ...(data ? sanitizeRecord(data) : {}),
  };

  console.info("[integration]", event, payload);

  if (!isTauri()) {
    return;
  }

  void invoke("append_integration_log", {
    content: `${JSON.stringify(payload)}\n`,
  }).catch(() => {
    // Never break OAuth flows because of logging.
  });
}
