export function fitFrameSize(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: maxDimension, height: Math.round(maxDimension * 9 / 16) };
  }
  const scale = maxDimension / Math.max(sourceWidth, sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  event: "loadeddata" | "seeked",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(video.error ?? new Error(`thumbnail video ${event} failed`));
    };
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

/** Paints the full video frame scaled to the canvas (no crop). */
function paintFullFrame(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw <= 0 || vh <= 0) return;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/**
 * Best-effort still frame from a playable video URL.
 * Canvas matches the source aspect ratio so the full frame is visible.
 */
export async function captureVideoThumbnailCanvas(
  videoUrl: string,
  maxDimension: number,
  seekSec = 0.15,
): Promise<HTMLCanvasElement | null> {
  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    if (video.readyState < 2) {
      await waitForVideoEvent(video, "loadeddata");
    }
    video.currentTime = seekSec;
    await waitForVideoEvent(video, "seeked");
    if (video.videoWidth <= 0) return null;

    const { width, height } = fitFrameSize(
      video.videoWidth,
      video.videoHeight,
      maxDimension,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    paintFullFrame(canvas, video);
    return canvas;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
