import type { StreamTargetChunk } from "mediabunny";

/**
 * Adapts a file-system stream for libraries which acquire a writer lock on the
 * stream they receive. The converter retains ownership of the real stream so
 * it can close it after a successful conversion or abort it on failure.
 */
export function createFileSystemWriteProxy(
  writable: FileSystemWritableFileStream,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write(chunk) {
      return writable.write(chunk);
    },
  });
}
