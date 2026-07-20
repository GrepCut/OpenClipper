/**
 * Generalization feature flags (handoff §3.3–§5.5).
 * Production features default ON; set `CLIPPER_*=0` to disable.
 * Shadow / holdout flags stay opt-in (`=1`).
 */

function readEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env?.[name] != null) {
    return process.env[name];
  }
  if (typeof window !== "undefined") {
    const stored = window.localStorage?.getItem(name);
    if (stored != null) return stored;
  }
  const vite = import.meta.env[`VITE_${name}`];
  return vite != null ? String(vite) : undefined;
}

function envProductionOn(name: string): boolean {
  const raw = readEnv(name);
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return true;
}

function envOptIn(name: string): boolean {
  const raw = readEnv(name);
  return raw === "1" || raw === "true";
}

/** Minimalny union crop dla 3+ osób (handoff §3.4). */
export function groupUnionCropEnabled(): boolean {
  return envProductionOn("CLIPPER_GROUP_UNION_CROP");
}

/** Kompensacja globalnego ruchu kamery w ByteTrack (handoff §5.4). */
export function cameraMotionCompensationEnabled(): boolean {
  return envProductionOn("CLIPPER_CAMERA_MOTION_COMPENSATION");
}

/** OneEuro smoothing wewnątrz ujęć (handoff §5.5). */
export function shotCropSmoothingEnabled(): boolean {
  return envProductionOn("CLIPPER_SHOT_CROP_SMOOTHING");
}

/** TransNet scene cuts — production default ON; set `CLIPPER_TRANSNET_SCENE_CUTS=0` to disable. */
export function transnetSceneCutsEnabled(): boolean {
  return envProductionOn("CLIPPER_TRANSNET_SCENE_CUTS");
}

/** Holdout clips w benchmark UI — opt-in. */
export function allowHoldoutBenchmarkEnabled(): boolean {
  return envOptIn("CLIPPER_ALLOW_HOLDOUT");
}
