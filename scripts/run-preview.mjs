import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const variant = process.argv[2] ?? "fast";
const targetDir = variant === "fast" ? "target-fast" : "target";
const exe = resolve("src-tauri", targetDir, "release", "open-clipper.exe");

if (!existsSync(exe)) {
  console.error(`Missing ${exe}`);
  console.error(
    `Run: npm run tauri:build${variant === "fast" ? ":fast" : ""}`,
  );
  process.exit(1);
}

const child = spawn(exe, [], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

await new Promise((resolveDelay) => setTimeout(resolveDelay, 2500));

if (child.exitCode !== null) {
  console.error(
    `Open Clipper exited immediately (code ${child.exitCode ?? 1}).`,
  );
  const message = stderr.trim();
  if (message) {
    console.error(message);
  }
  process.exit(child.exitCode ?? 1);
}

child.unref();
console.log(`Open Clipper started (${exe}).`);
