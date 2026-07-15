import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

/** Reads display dimensions from the primary video track (Mediabunny). */
export async function readVideoDisplayDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error("This file has no video track.");
    }
    return {
      width: track.displayWidth,
      height: track.displayHeight,
    };
  } finally {
    input.dispose();
  }
}
