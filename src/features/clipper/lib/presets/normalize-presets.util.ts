export interface NormalizePreset {
  value: string;
  /** Short display name, e.g. "Streaming". */
  name: string;
  label: string;
  hint: string;
  targetLufs: number;
  peakCeiling: number;
}

export const LUFS_PRESETS: NormalizePreset[] = [
  {
    value: "streaming",
    name: "Streaming",
    label: "Streaming (−14 LUFS)",
    hint: "YouTube, Spotify",
    targetLufs: -14,
    peakCeiling: -1,
  },
  {
    value: "podcast",
    name: "Podcast",
    label: "Podcast (−16 LUFS)",
    hint: "Spoken word",
    targetLufs: -16,
    peakCeiling: -1,
  },
  {
    value: "broadcast",
    name: "Broadcast",
    label: "Broadcast (−23 LUFS)",
    hint: "EBU R128 TV",
    targetLufs: -23,
    peakCeiling: -1,
  },
];

export const DEFAULT_NORMALIZE_PRESET = "streaming";

export function getNormalizePreset(value: string): NormalizePreset {
  return LUFS_PRESETS.find((p) => p.value === value) ?? LUFS_PRESETS[0];
}

export const TARGET_PRESETS: Record<string, number> = Object.fromEntries(
  LUFS_PRESETS.map((p) => [p.value, p.targetLufs]),
);
