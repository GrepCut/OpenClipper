import { openDB, type IDBPDatabase } from "idb";
import { isTauri } from "../../../shared/utils/platform.util";
import { pathBackedFile } from "../platform/native-source.util";

type LocalMediaSourceRecord = {
  kind: "tauri-path";
  fileName: string;
  fileType: string;
  path: string;
};

const DB_NAME = "open-clipper-local-media-sources";
const DB_VERSION = 1;
const STORE_NAME = "sources";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDbPromise(): Promise<IDBPDatabase> | null {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function storeLocalMediaSource(
  assetId: string,
  source: LocalMediaSourceRecord,
): Promise<void> {
  const db = getDbPromise();
  if (!db) return;
  const resolved = await db;
  await resolved.put(STORE_NAME, source, assetId);
}

export async function getLocalMediaSource(
  assetId: string,
): Promise<LocalMediaSourceRecord | null> {
  const db = getDbPromise();
  if (!db) return null;
  const resolved = await db;
  const source = (await resolved.get(STORE_NAME, assetId)) as
    | LocalMediaSourceRecord
    | undefined;
  return source ?? null;
}

export async function rememberLocalMediaSource(
  assetId: string,
  fileName: string,
  nativePath: string,
): Promise<void> {
  if (!nativePath || !isTauri()) return;
  await storeLocalMediaSource(assetId, {
    kind: "tauri-path",
    fileName,
    fileType: "video",
    path: nativePath,
  });
}

export async function resolveOrPromptLocalMediaSourceAsFile(item: {
  id: string;
  name: string;
}): Promise<File | null> {
  const cached = await getLocalMediaSource(item.id);
  if (cached?.path) {
    return pathBackedFile(cached.path, item.name);
  }

  if (!isTauri()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "mkv", "avi", "m4v"] }],
  });

  if (typeof selected !== "string" || !selected) return null;

  await rememberLocalMediaSource(item.id, item.name, selected);
  return pathBackedFile(selected, item.name);
}
