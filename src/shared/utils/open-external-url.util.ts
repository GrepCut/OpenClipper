import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./platform.util";

/** Opens a URL in the system browser (Tauri) or a new tab (web). */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
