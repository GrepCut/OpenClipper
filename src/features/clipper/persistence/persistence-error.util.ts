import * as Sentry from "@sentry/react";
import { appToast } from "../../../shared/utils/toast.service";
import { isDiskFullError } from "../shared/disk-full-error.util";

let lastReportAt = Number.NEGATIVE_INFINITY;

export function reportClipperPersistenceError(error: unknown): void {
  if (Date.now() - lastReportAt < 10_000) return;
  lastReportAt = Date.now();
  const message = error instanceof Error ? error.message : String(error);
  const full = isDiskFullError(error);
  appToast.error("Could not save project", full
    ? "Free disk space, then retry saving or closing the project. Keep the app open to preserve pending changes."
    : "Changes are still pending. Check storage access, then retry saving or closing the project.",
  { duration: 10_000 });
  if (full) {
    // Environment condition, not a bug: keep one grouped warning to track how often it happens.
    Sentry.captureMessage("Disk full", {
      level: "warning",
      fingerprint: ["disk-full", "clipper-persistence"],
      tags: { feature: "clipper-persistence", disk_full: "true" },
      extra: { message },
    });
    return;
  }
  Sentry.captureException(error instanceof Error ? error : new Error(message), {
    tags: { feature: "clipper-persistence" },
  });
}
