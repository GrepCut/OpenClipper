import { ALL_FORMATS, BlobSource, Input, UrlSource } from "mediabunny";
import { isTauri } from "../../../../shared/utils/platform.util";
import { getNativeFilePath } from "../../platform/native-source.util";
import {
  isAbsoluteNativePath,
  resolveFilePlayableUrl,
} from '../../persistence/tauri-media.util';

/** Mediabunny input for a browser File or a Tauri path-backed zero-byte File. */
export async function createMediabunnyInput(file: File): Promise<Input> {
  const path = getNativeFilePath(file);
  if (path && isTauri() && isAbsoluteNativePath(path)) {
    const url = await resolveFilePlayableUrl(file);
    return new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  }
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}
