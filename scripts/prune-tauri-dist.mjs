import { rm, stat } from "node:fs/promises";
import path from "node:path";

const modelsDir = path.resolve("dist", "models");

try {
  const info = await stat(modelsDir);
  await rm(modelsDir, { recursive: true, force: true });
  console.log(`Tauri dist cleanup: removed stale models directory (${info.size} bytes at root).`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.log("Tauri dist cleanup: no models directory to remove.");
}
