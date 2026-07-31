import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname, isAbsolute, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const LOCKED_FILE_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const STAGING_ARTIFACT_RE = /\.(tmp|stale)-[0-9a-f]+$/;

function cleanupStagingArtifacts(dir) {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    if (!STAGING_ARTIFACT_RE.test(entry)) {
      continue;
    }

    try {
      unlinkSync(join(dir, entry));
    } catch {
      // best-effort; locked stale files are removed when no longer in use
    }
  }
}

function printLockedFileHelp(dest) {
  console.error(
    `Could not replace locked MCP binary: ${dest}\n` +
      "Close Open Clipper and any MCP clients using open-clipper-mcp, then rebuild.",
  );

  if (process.platform === "win32") {
    console.error(
      "PowerShell — processes using open-clipper-mcp:\n" +
        "  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*open-clipper-mcp*' } | Select Name, ProcessId, CommandLine",
    );
  }
}

async function copyFileWithRetry(source, dest, { retries = 12, delayMs = 250 } = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  const tempDest = `${dest}.tmp-${randomBytes(4).toString("hex")}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let staleDest = null;

    try {
      copyFileSync(source, tempDest);

      if (existsSync(dest)) {
        staleDest = `${dest}.stale-${randomBytes(4).toString("hex")}`;
        renameSync(dest, staleDest);
      }

      renameSync(tempDest, dest);

      if (staleDest) {
        try {
          unlinkSync(staleDest);
        } catch (err) {
          if (LOCKED_FILE_CODES.has(err.code)) {
            console.warn(
              `Left locked previous MCP binary as ${basename(staleDest)}; remove it when no longer in use.`,
            );
          }
        }
      }

      return;
    } catch (err) {
      try {
        if (existsSync(tempDest)) {
          unlinkSync(tempDest);
        }
      } catch {
        // ignore cleanup errors
      }

      if (staleDest && existsSync(staleDest) && !existsSync(dest)) {
        try {
          renameSync(staleDest, dest);
        } catch {
          // restore failed; dest may be missing until next successful stage
        }
      }

      const locked = LOCKED_FILE_CODES.has(err.code);
      if (!locked || attempt === retries) {
        if (locked) {
          printLockedFileHelp(dest);
        }
        throw err;
      }

      await delay(delayMs * attempt);
    }
  }
}

const root = join(import.meta.dirname, "..");
const tauriDir = join(root, "src-tauri");
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc";
const profile =
  process.env.CARGO_BUILD_PROFILE ?? process.env.CARGO_PROFILE ?? "release";
const releaseFlag = profile === "release" ? ["--release"] : [];
const targetDirName = process.env.CARGO_TARGET_DIR ?? "target";
const targetRoot = isAbsolute(targetDirName)
  ? targetDirName
  : join(tauriDir, targetDirName);
const binName = triple.includes("windows") ? "open-clipper-mcp.exe" : "open-clipper-mcp";
const source = join(targetRoot, profile, binName);
const destDir = join(tauriDir, "bin");
const dest = join(
  destDir,
  `open-clipper-mcp-${triple}${triple.includes("windows") ? ".exe" : ""}`,
);

cleanupStagingArtifacts(destDir);

const build = spawnSync(
  "cargo",
  ["build", "--bin", "open-clipper-mcp", ...releaseFlag],
  {
    cwd: tauriDir,
    stdio: "inherit",
    shell: true,
    env: process.env,
  },
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

if (!existsSync(source)) {
  console.error(`MCP binary missing after build: ${source}`);
  process.exit(1);
}

await copyFileWithRetry(source, dest);
console.log(`Staged MCP binary: ${dest}`);

const profileDir = join(targetRoot, profile);
const besideApp = join(profileDir, binName);
if (existsSync(profileDir) && besideApp !== source) {
  await copyFileWithRetry(source, besideApp);
  console.log(`Copied MCP binary beside app: ${besideApp}`);
}
