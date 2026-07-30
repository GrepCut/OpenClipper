import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../../shared/utils/platform.util";

let cachedGpuProbe: boolean | null = null;

/** Returns whether wgpu + klyff caption rendering is available in the native shell. */
export async function probeCaptionGpu(): Promise<boolean> {
  if (!isTauri()) return false;
  if (cachedGpuProbe !== null) return cachedGpuProbe;
  try {
    cachedGpuProbe = await invoke<boolean>("probe_caption_gpu");
  } catch {
    cachedGpuProbe = false;
  }
  return cachedGpuProbe;
}

export function resetCaptionGpuProbeCache(): void {
  cachedGpuProbe = null;
}
