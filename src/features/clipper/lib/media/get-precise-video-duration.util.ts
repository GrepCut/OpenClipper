/** Probes video duration from a File or playable URL. */
export async function getPreciseVideoDuration(
  file: File,
  playableUrl?: string,
): Promise<number> {
  const url = playableUrl ?? URL.createObjectURL(file);
  const ownsUrl = !playableUrl;

  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new Error("Could not read video duration."));
          return;
        }
        resolve(duration);
      };
      video.onerror = () => reject(new Error("Could not read video metadata."));
      video.src = url;
    });
  } finally {
    if (ownsUrl) URL.revokeObjectURL(url);
  }
}
