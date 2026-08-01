import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform.util";

export function createTranscriptionDiagRunId(): string {
  return crypto.randomUUID();
}

export function logTranscriptionDiag(
  stage: string,
  details?: Record<string, unknown>,
): void {
  if (!isTauri()) {
    return;
  }

  void invoke("append_transcription_diag_log", {
    stage,
    details: details ?? {},
  }).catch(() => {
    // Never break transcription because of logging.
  });
}
