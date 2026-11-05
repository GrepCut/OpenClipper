import * as Sentry from "@sentry/react";
import { appToast } from "../../../shared/utils/toast.service";

let lastReportAt = Number.NEGATIVE_INFINITY;

export function reportClipperPersistenceError(error: unknown): void {
  if (Date.now() - lastReportAt < 10_000) return;
  lastReportAt = Date.now();
  const message = error instanceof Error ? error.message : String(error);
  const full = /disk is full|database or disk is full|SQLITE_FULL|quota/i.test(message);
  appToast.error("Could not save project", full
    ? "Free disk space, then retry saving or closing the project. Keep the app open to preserve pending changes."
    : "Changes are still pending. Check storage access, then retry saving or closing the project.",
  { duration: 10_000 });
  Sentry.captureException(error instanceof Error ? error : new Error(message), {
    tags: { feature: "clipper-persistence" },
  });
}
