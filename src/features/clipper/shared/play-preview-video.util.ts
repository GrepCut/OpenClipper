import { appToast } from "../../../shared/utils/toast.service";

/** play() commonly rejects when a subsequent pause or source change wins the race. */
export async function playPreviewVideo(video: HTMLVideoElement): Promise<void> {
  const source = video.currentSrc || video.src;
  try {
    await video.play();
  } catch (error) {
    if ((error instanceof Error && error.name === "AbortError")
      || source !== (video.currentSrc || video.src)) return;
    const unsupported = error instanceof Error && error.name === "NotSupportedError";
    appToast.error("Could not play preview", unsupported
      ? "The video source is missing or unsupported. Reopen the source video and try again. Your clips are preserved."
      : "Playback could not start. Click Play to retry.");
  }
}
