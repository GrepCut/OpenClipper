import { canEncodeVideo, type VideoEncodingConfig } from "mediabunny";

// H.264 picture-size and bitrate limits, matching Mediabunny's level selection.
const LEVELS = [
  [1620, 10_000_000, 30], [3600, 14_000_000, 31], [5120, 20_000_000, 32],
  [8192, 20_000_000, 40], [8192, 50_000_000, 41], [8704, 50_000_000, 42],
  [22080, 135_000_000, 50], [36864, 240_000_000, 51],
  [139264, 240_000_000, 60], [139264, 480_000_000, 61], [139264, 800_000_000, 62],
] as const;

/** Keep the requested output size/bitrate, falling back through compatible AVC encoders. */
export async function resolveClipperEncoderConfig(
  width: number,
  height: number,
  bitrate: number,
  signal?: AbortSignal,
): Promise<VideoEncodingConfig> {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = LEVELS.find(([blocks, bits]) => macroblocks <= blocks && bitrate <= bits)?.[2];
  if (!level) throw new Error(`H.264 output parameters exceed supported levels (${width}×${height}).`);
  for (const profile of ["6400", "4d00", "4200"]) {
    for (const hardwareAcceleration of ["no-preference", "prefer-software"] as const) {
      signal?.throwIfAborted();
      const config: VideoEncodingConfig = {
        codec: "avc", bitrate, latencyMode: "quality", hardwareAcceleration,
        fullCodecString: `avc1.${profile}${level.toString(16).padStart(2, "0")}`,
      };
      try {
        if (await canEncodeVideo("avc", { ...config, width, height })) {
          signal?.throwIfAborted();
          return config;
        }
      } catch (error) {
        signal?.throwIfAborted();
        // Some browsers throw instead of returning unsupported for an AVC profile.
        if (!(error instanceof Error)) throw error;
      }
    }
  }
  throw new Error(
    `This browser cannot encode H.264 at ${width}×${height} and ${bitrate} bps, including software encoding. `
    + "Your project and prepared clips are preserved. Update WebView2 or choose another output setting and retry.",
  );
}
