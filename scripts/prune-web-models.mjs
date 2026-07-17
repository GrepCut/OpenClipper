// Production web loads ML assets from models.openclipper.grepcut.com.
// Vite copies public/ into dist by default, so remove the duplicate models.
import { rm, stat } from "node:fs/promises";
import path from "node:path";

const target = path.resolve("dist", "models");

try {
  await stat(target);
  await rm(target, { recursive: true, force: true });
  console.log("Web dist pruned: models directory removed");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.log("Web dist pruned: no models directory present");
}
