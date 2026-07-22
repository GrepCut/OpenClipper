import type { StreamTargetChunk } from "mediabunny";

export const CLIPPER_EXPORTS_SUBDIR = "exports";
export const CLIPPER_EXPORTS_MANIFEST = "manifest.json";
export const CLIPPER_WEB_DATA_SUBDIR = "clipper-data";

export const MANIFEST_RELATIVE_PATH = `${CLIPPER_EXPORTS_SUBDIR}/${CLIPPER_EXPORTS_MANIFEST}`;

export const CLIPPER_EXPORT_MANIFEST_VERSION = 2;

export interface ClipperExportManifestEntry {
  id: string;
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  exportedAt: string;
  clipStartSec?: number;
  clipEndSec?: number;
}

export interface ClipperExportManifestV1Entry {
  clipIndex: number;
  formatId: string;
  fileName: string;
  relativePath: string;
  width: number;
  height: number;
  fileSize: number;
  updatedAt: string;
}

export interface ClipperExportManifest {
  version: typeof CLIPPER_EXPORT_MANIFEST_VERSION;
  exports: ClipperExportManifestEntry[];
}

export interface ClipperDiskExport {
  relativePath: string;
  displayPath: string;
  filePath: string;
  fileSize: number;
  file: File;
  previewUrl: string;
}

export interface ClipperExportSink {
  writable: WritableStream<StreamTargetChunk>;
  relativePath: string;
  fileName: string;
  finalize(): Promise<ClipperDiskExport>;
  abort(): Promise<void>;
}
