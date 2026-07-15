/** Shared Mediabunny conversion pipeline used by browser-based converters. */

import {
  BufferTarget,
  Conversion,
  Output,
  StreamTarget,
} from "mediabunny";
import type { ConversionOutput, ConvertOptions } from "../types/converter.types";
import type { MediabunnyConvertConfig } from "../types/mediabunny-convert.types";
import { createMediabunnyInput } from '../media/mediabunny-file-source';
import { createThrottledProgressReporter } from "./throttled-progress";
import { createFileSystemWriteProxy } from "./file-system-write-proxy";

export function isMediabunnyConvertSupported(): boolean {
  return (
    typeof VideoDecoder !== "undefined" &&
    typeof AudioDecoder !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined"
  );
}

function describeInvalidConversion(conversion: Conversion): string {
  const { discardedTracks } = conversion;
  const reasons = new Set(discardedTracks.map((track) => track.reason));
  const audioTracks = discardedTracks.filter((entry) => entry.track.type === "audio");
  const onlyVideoDiscardedByUser =
    discardedTracks.length > 0 &&
    discardedTracks.every((entry) => entry.reason === "discarded_by_user") &&
    audioTracks.length === 0;

  if (onlyVideoDiscardedByUser) {
    return (
      "This file has no audio track — it looks like a video-only file. " +
      "Choose a video that includes sound to extract MP3 or WAV."
    );
  }
  if (reasons.has("undecodable_source_codec")) {
    return "This file uses a codec your browser cannot decode in-browser.";
  }
  if (reasons.has("no_encodable_target_codec")) {
    return "Your browser cannot encode this file to the target format. Try the latest Chrome, Edge, or Opera.";
  }
  if (reasons.has("unknown_source_codec")) {
    return "The codec of this file could not be recognized.";
  }
  if (reasons.has("max_track_count_of_type_reached")) {
    return "This file has more audio tracks than the output format supports.";
  }
  return "This file cannot be converted to the requested format.";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Conversion aborted", "AbortError");
  }
}

async function executeMediabunnyConversion(
  file: File,
  config: MediabunnyConvertConfig,
  options: ConvertOptions,
  target: BufferTarget | StreamTarget,
  mode: ConversionOutput["kind"],
): Promise<void> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  const progress = createThrottledProgressReporter(onProgress);
  const input = await createMediabunnyInput(file);

  try {
    progress.report({ ratio: null, stage: "reading" });

    let prepared: Pick<MediabunnyConvertConfig, "video" | "audio"> = {};
    if (config.prepare) {
      progress.report({ ratio: null, stage: "analyzing" });
      prepared = await config.prepare(input, file);
      throwIfAborted(signal);
    }

    const output = new Output({ format: config.createFormat(mode), target });
    const conversion = await Conversion.init({
      input,
      output,
      video: prepared.video ?? config.video,
      audio: prepared.audio ?? config.audio,
      trim: config.trim,
    });

    if (!conversion.isValid) {
      throw new Error(describeInvalidConversion(conversion));
    }

    const stage = config.stage ?? "converting";
    conversion.onProgress = (ratio) => progress.report({ ratio, stage });
    const cancelConversion = () => void conversion.cancel();
    signal?.addEventListener("abort", cancelConversion, { once: true });

    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener("abort", cancelConversion);
    }

    throwIfAborted(signal);
    progress.report({ ratio: 1, stage: "finalizing" });
  } finally {
    input.dispose();
    progress.dispose();
  }
}

/** Converts a File entirely in the browser, to memory or directly to disk. */
export async function convertWithMediabunny(
  file: File,
  config: MediabunnyConvertConfig,
  options: ConvertOptions = {},
): Promise<ConversionOutput> {
  if (!options.outputFileHandle) {
    const buffer = await convertWithMediabunnyBuffer(file, config, options);
    return { kind: "memory", blob: new Blob([buffer], { type: config.mimeType }) };
  }

  return convertWithMediabunnyToFile(file, config, options);
}

/** Runs the shared pipeline and returns transferable in-memory bytes. */
export async function convertWithMediabunnyBuffer(
  file: File,
  config: MediabunnyConvertConfig,
  options: ConvertOptions = {},
): Promise<ArrayBuffer> {
  const target = new BufferTarget();
  await executeMediabunnyConversion(file, config, options, target, "memory");

  if (!target.buffer) {
    throw new Error("Conversion produced no output.");
  }

  return target.buffer;
}

async function convertWithMediabunnyToFile(
  file: File,
  config: MediabunnyConvertConfig,
  options: ConvertOptions,
): Promise<ConversionOutput> {
  const outputFileHandle = options.outputFileHandle;
  if (!outputFileHandle) throw new Error("Missing output file handle.");
  throwIfAborted(options.signal);

  const writable = await outputFileHandle.createWritable();
  let completed = false;

  try {
    const target = new StreamTarget(createFileSystemWriteProxy(writable), { chunked: true });
    await executeMediabunnyConversion(file, config, options, target, "file");
    await writable.close();
    completed = true;
    return { kind: "file", size: (await outputFileHandle.getFile()).size };
  } finally {
    if (!completed) await writable.abort().catch(() => {});
  }
}
