import type { TestClip } from "../types";

/** Kohorty z handoff §5.1 — rozszerzaj przy dodawaniu nowych klipów. */
export const BENCHMARK_COHORTS = [
  "talking-head",
  "multi-person-interview",
  "music-video",
  "sport-fast",
  "animation",
  "animals",
  "screen-gameplay",
  "vlog-handheld",
  "concert-crowd",
  "letterbox",
  "vertical-source",
  "low-quality",
  "mixed",
] as const;

export type BenchmarkCohort = (typeof BENCHMARK_COHORTS)[number];

export type DatasetRole = "tuning" | "holdout";

export function parseCohortTagsJson(raw: string | undefined): BenchmarkCohort[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is BenchmarkCohort =>
      typeof tag === "string" && (BENCHMARK_COHORTS as readonly string[]).includes(tag));
  } catch {
    return [];
  }
}

/** DB tags first; empty clips fall back to name heuristics (test1 seed). */
export function resolveClipCohorts(clip: TestClip): BenchmarkCohort[] {
  const stored = parseCohortTagsJson(clip.cohortTagsJson);
  if (stored.length) return stored;
  const name = clip.name.toLowerCase();
  if (name.includes("mrbeast") || name.includes("interview")) return ["multi-person-interview"];
  if (name.includes("export_2026") || name.includes("podcast")) return ["talking-head"];
  if (name.includes("super-bass") || name.includes("music")) return ["music-video"];
  if (name.includes("spring") || name.includes("blender")) return ["animation"];
  if (name.includes("snowboard") || name.includes("sport")) return ["sport-fast"];
  return ["mixed"];
}

