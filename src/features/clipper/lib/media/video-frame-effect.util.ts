/**
 * Shared "bake a per-frame Canvas 2D effect into a video" pipeline. Decodes
 * every video frame via Mediabunny (WebCodecs), lets the caller draw into an
 * OffscreenCanvas, and re-encodes the result. Audio is copied (AAC) or
 * transcoded to AAC unchanged. Modeled on `rotate-video/process/bake-rotate.ts`.
 */
export {
  AAC_BITRATE,
  encodeBitrateForSizedOutput,
  highQualityVideoBitrate,
  resolveVideoSourceSize,
  throwIfAborted,
  type AudioTrackMode,
  type FrameEffect,
  type FrameEffectSize,
  type InputAudioTrack,
  type SizedFrameEffect,
} from "./video-frame-effect.types";
export {
  FrameCanvasCache,
  applyFrameEffectToImageData,
  downscaleImageData,
  renderEffectFrame,
  renderFrameEffectPreview,
  renderSizedEffectFrame,
  resetContext,
} from "./video-frame-effect-render.util";
export { createAudioSource, processAudioTrack } from "./video-frame-effect-audio.util";
export { bakeVideoFrameEffect, bakeVideoSizedFrameEffect } from "./video-frame-effect-bake.util";
