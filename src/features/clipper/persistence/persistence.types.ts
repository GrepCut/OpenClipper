export type ClipperMediaFileType = "video" | "audio" | "image";

/** Minimal media descriptor used by clipper persistence (no video-editor types). */
export interface ClipperMediaFile {
  id: string;
  name: string;
  relativePath: string;
  duration: number;
  width: number;
  height: number;
  sourcePath: string | null;
  fileType: ClipperMediaFileType;
}

export { StorageLocation } from "../../../shared/types/storage.types";
