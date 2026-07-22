import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type InputVideoTrack,
} from "mediabunny";
import { createFileSystemWriteProxy } from "../convert/file-system-write-proxy.util";
import type { ConvertOptions } from "../types/converter.types";
import { throwIfAborted } from "./video-frame-effect.types";

export interface BakeOutputContext {
  input: Input;
  output: Output;
  videoTrack: InputVideoTrack;
  audioTrack: Awaited<ReturnType<Input["getAudioTracks"]>>[number] | null;
  totalDuration: number;
  writable: FileSystemWritableFileStream | null;
  target: BufferTarget | StreamTarget;
  toFile: boolean;
  completed: boolean;
  signal?: AbortSignal;
}

export async function createBakeOutputContext(
  file: File,
  options: ConvertOptions,
): Promise<BakeOutputContext> {
  const { signal, outputFileHandle } = options;
  throwIfAborted(signal);

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const toFile = Boolean(outputFileHandle);
  const writable = outputFileHandle ? await outputFileHandle.createWritable() : null;
  const target = writable
    ? new StreamTarget(createFileSystemWriteProxy(writable), { chunked: true })
    : new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: toFile ? false : "in-memory" });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    input.dispose();
    throw new Error("No video track found in the input file.");
  }
  const audioTrack = (await input.getAudioTracks())[0] ?? null;
  const totalDuration = await input.computeDuration();
  const output = new Output({ format, target });

  return {
    input,
    output,
    videoTrack,
    audioTrack,
    totalDuration,
    writable,
    target,
    toFile,
    completed: false,
    signal,
  };
}

export async function finalizeBakeOutput(
  ctx: BakeOutputContext,
  outputFileHandle?: FileSystemFileHandle,
): Promise<{ kind: "file"; size: number } | { kind: "memory"; blob: Blob }> {
  if (ctx.toFile) {
    await ctx.writable!.close();
    return { kind: "file", size: (await outputFileHandle!.getFile()).size };
  }
  const buffer = (ctx.target as BufferTarget).buffer;
  if (!buffer) throw new Error("Conversion produced no output.");
  return { kind: "memory", blob: new Blob([buffer], { type: "video/mp4" }) };
}

export async function disposeBakeOutputContext(ctx: BakeOutputContext): Promise<void> {
  ctx.input.dispose();
  if (ctx.writable && !ctx.completed) await ctx.writable.abort().catch(() => {});
}
