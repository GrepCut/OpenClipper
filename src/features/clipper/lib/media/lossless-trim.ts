/**
 * Keyframe-aligned stream copy trim (lossless, no decode/re-encode).
 * Shared by video-trimmer and clipper.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
} from "mediabunny";
import { convertWithMediabunny } from '../convert/mediabunny-convert';
import { createFileSystemWriteProxy } from '../convert/file-system-write-proxy';
import type { ConvertOptions, ConversionOutput } from '../types/converter.types';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Conversion aborted", "AbortError");
}

/**
 * Previews the keyframe-aligned start `trimVideoLosslessCopy` will actually use
 * for a given `start`, so callers needing byte-exact A/V sync (e.g. pairing a
 * separately-extracted audio track) can align both extractions to the same point.
 */
export async function snapToPrecedingKeyframe(file: File, start: number): Promise<number> {
  if (start <= 0) return 0;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return 0;
    const videoSink = new EncodedPacketSink(videoTrack);
    const keyPacket = await videoSink.getKeyPacket(start, { verifyKeyPackets: true });
    return keyPacket ? keyPacket.timestamp : 0;
  } finally {
    input.dispose();
  }
}

function outputMimeForFile(file: File): string {
  return file.name.endsWith(".webm") || file.type === "video/webm"
    ? "video/webm"
    : "video/mp4";
}

/**
 * `fastStart: false` is only correct when streaming straight to disk (`hasFileHandle`) — buffering
 * the whole output in memory just to move `moov` to the front would defeat that streaming write.
 * When writing to an in-memory `BufferTarget`, omit the option so mediabunny's own default applies
 * (`'in-memory'` faststart), since the entire output already lives in memory anyway. Without this,
 * the trimmed MP4's `moov` box lands at EOF, which can leave native `<video>` playback stuck (black
 * screen) when read back over `asset.localhost`/`blob:` URLs — see Clipper preview.
 */
function createOutputFormat(file: File, hasFileHandle: boolean) {
  const isWebM = file.name.endsWith(".webm") || file.type === "video/webm";
  if (isWebM) return new WebMOutputFormat();
  return new Mp4OutputFormat(hasFileHandle ? { fastStart: false } : {});
}

/**
 * Lossless trim via encoded packet copy. Start aligns to the nearest preceding keyframe.
 */
export async function trimVideoLosslessCopy(
  file: File,
  start: number,
  end: number | undefined,
  options: ConvertOptions = {},
): Promise<ConversionOutput> {
  const { onProgress, signal, outputFileHandle } = options;
  throwIfAborted(signal);

  onProgress?.({ ratio: 0.1, stage: "analyzing keyframes" });

  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  const outputMime = outputMimeForFile(file);
  const writable = outputFileHandle ? await outputFileHandle.createWritable() : null;
  let completed = false;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    const videoDuration = await input.computeDuration();
    const finalEnd = end != null && Number.isFinite(end) ? end : videoDuration;

    const target = writable
      ? new StreamTarget(createFileSystemWriteProxy(writable), { chunked: true })
      : new BufferTarget();

    if (!videoTrack) {
      const output = new Output({ format: createOutputFormat(file, !!writable), target });
      const audioSource = new EncodedAudioPacketSource(audioTrack ? audioTrack.codec! : "aac");
      output.addAudioTrack(audioSource);
      await output.start();

      if (audioTrack) {
        const audioSink = new EncodedPacketSink(audioTrack);
        let audioPacket = await audioSink.getPacket(start);
        if (!audioPacket) audioPacket = await audioSink.getFirstPacket();

        let isFirstAudio = true;
        while (audioPacket) {
          throwIfAborted(signal);
          if (audioPacket.timestamp > finalEnd) break;

          const shiftedPacket = audioPacket.clone({
            timestamp: audioPacket.timestamp - start,
          });

          const audioConfig = await audioTrack.getDecoderConfig();
          const meta = isFirstAudio && audioConfig ? { decoderConfig: audioConfig } : undefined;
          isFirstAudio = false;

          await audioSource.add(shiftedPacket, meta);
          audioPacket = await audioSink.getNextPacket(audioPacket);
        }
      }

      await audioSource.close();
      await output.finalize();

      if (writable) {
        await writable.close();
      }
      completed = true;

      if (outputFileHandle) {
        return { kind: "file", size: (await outputFileHandle.getFile()).size };
      }
      return { kind: "memory", blob: new Blob([(target as BufferTarget).buffer!], { type: outputMime }) };
    }

    const videoSink = new EncodedPacketSink(videoTrack);
    const keyPacket = await videoSink.getKeyPacket(start, { verifyKeyPackets: true });
    const adjustedStart = start > 0 && keyPacket ? keyPacket.timestamp : 0;

    const output = new Output({ format: createOutputFormat(file, !!writable), target });
    const videoSource = new EncodedVideoPacketSource(videoTrack.codec!);
    output.addVideoTrack(videoSource);

    let audioSource: EncodedAudioPacketSource | null = null;
    if (audioTrack) {
      audioSource = new EncodedAudioPacketSource(audioTrack.codec!);
      output.addAudioTrack(audioSource);
    }

    await output.start();

    onProgress?.({ ratio: 0.4, stage: "copying video packets" });
    let copyVideoPacket = start > 0 && keyPacket ? keyPacket : await videoSink.getFirstPacket();

    let isFirstVideo = true;
    while (copyVideoPacket) {
      throwIfAborted(signal);
      if (copyVideoPacket.timestamp > finalEnd) break;

      if (copyVideoPacket.timestamp < adjustedStart) {
        copyVideoPacket = await videoSink.getNextPacket(copyVideoPacket);
        continue;
      }

      const shiftedPacket = copyVideoPacket.clone({
        timestamp: copyVideoPacket.timestamp - adjustedStart,
      });

      const videoConfig = await videoTrack.getDecoderConfig();
      const meta = isFirstVideo && videoConfig ? { decoderConfig: videoConfig } : undefined;
      isFirstVideo = false;

      await videoSource.add(shiftedPacket, meta);
      copyVideoPacket = await videoSink.getNextPacket(copyVideoPacket);
    }

    if (audioTrack && audioSource) {
      onProgress?.({ ratio: 0.8, stage: "copying audio packets" });
      const audioSink = new EncodedPacketSink(audioTrack);
      let audioPacket = await audioSink.getPacket(adjustedStart);
      if (!audioPacket) audioPacket = await audioSink.getFirstPacket();

      let isFirstAudio = true;
      while (audioPacket) {
        throwIfAborted(signal);
        if (audioPacket.timestamp > finalEnd) break;

        if (audioPacket.timestamp < adjustedStart) {
          audioPacket = await audioSink.getNextPacket(audioPacket);
          continue;
        }

        const shiftedPacket = audioPacket.clone({
          timestamp: audioPacket.timestamp - adjustedStart,
        });

        const audioConfig = await audioTrack.getDecoderConfig();
        const meta = isFirstAudio && audioConfig ? { decoderConfig: audioConfig } : undefined;
        isFirstAudio = false;

        await audioSource.add(shiftedPacket, meta);
        audioPacket = await audioSink.getNextPacket(audioPacket);
      }
    }

    onProgress?.({ ratio: 0.95, stage: "finalizing" });
    await videoSource.close();
    if (audioSource) await audioSource.close();
    await output.finalize();

    if (writable) {
      await writable.close();
    }
    completed = true;

    if (outputFileHandle) {
      return { kind: "file", size: (await outputFileHandle.getFile()).size };
    }
    return { kind: "memory", blob: new Blob([(target as BufferTarget).buffer!], { type: outputMime }) };
  } finally {
    if (writable && !completed) {
      await writable.abort().catch(() => {});
    }
    input.dispose();
  }
}

async function trimVideoTranscodeFallback(
  file: File,
  start: number,
  end: number | undefined,
  options: ConvertOptions,
): Promise<ConversionOutput> {
  const outputMime = outputMimeForFile(file);
  return convertWithMediabunny(
    file,
    {
      createFormat: () => createOutputFormat(file, !!options.outputFileHandle),
      mimeType: outputMime,
      trim: {
        start: Number.isFinite(start) ? Math.max(0, start) : 0,
        end: end != null && Number.isFinite(end) ? end : undefined,
      },
      stage: "trimming (fallback)",
    },
    options,
  );
}

/** Lossless trim with transcode fallback — same strategy as video-trimmer. */
export async function trimVideoToBlob(
  file: File,
  start: number,
  end: number | undefined,
  options: ConvertOptions = {},
): Promise<Blob> {
  try {
    const result = await trimVideoLosslessCopy(file, start, end, options);
    if (result.kind === "memory") return result.blob;
    const saved = await options.outputFileHandle!.getFile();
    return saved;
  } catch (err) {
    console.warn("[LosslessTrim] Failed, falling back to transcode trim:", err);
    const result = await trimVideoTranscodeFallback(file, start, end, options);
    if (result.kind === "memory") return result.blob;
    return await options.outputFileHandle!.getFile();
  }
}

export async function trimVideoToBuffer(
  file: File,
  start: number,
  end: number,
  options: Pick<ConvertOptions, "signal" | "onProgress"> = {},
): Promise<ArrayBuffer> {
  const blob = await trimVideoToBlob(file, start, end, options);
  return blob.arrayBuffer();
}
