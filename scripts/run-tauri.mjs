import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const mode = process.argv[2];
const forwardedArgs = process.argv.slice(3);

if (!mode || !["build", "dev"].includes(mode)) {
  console.error("Usage: node scripts/run-tauri.mjs <build|dev> [args...]");
  process.exit(1);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const parsed = {};
  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

const productionEnv = parseEnvFile(resolve(rootDir, ".env.production"));
const localEnv = parseEnvFile(resolve(rootDir, ".env"));
const mergedEnv = {
  ...localEnv,
  ...productionEnv,
  ...process.env,
};

const updaterPubkey = mergedEnv.OPEN_CLIPPER_UPDATER_PUBKEY?.trim();
const updaterEndpoint = mergedEnv.OPEN_CLIPPER_UPDATER_ENDPOINT?.trim();
const hasUpdaterConfig = Boolean(updaterPubkey) && Boolean(updaterEndpoint);

const skipsBundle = forwardedArgs.includes("--no-bundle");

if (mode === "build" && !skipsBundle) {
  if (!hasUpdaterConfig) {
    console.error(
      "Missing OPEN_CLIPPER_UPDATER_PUBKEY or OPEN_CLIPPER_UPDATER_ENDPOINT in .env/.env.production.",
    );
    process.exit(1);
  }

  const inlinePrivateKey = mergedEnv.TAURI_SIGNING_PRIVATE_KEY?.trim();
  const privateKeyPath = mergedEnv.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim();

  if (!inlinePrivateKey && !privateKeyPath) {
    console.error(
      "Missing TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH in .env/.env.production.",
    );
    process.exit(1);
  }
}

const generatedConfigPath = resolve(
  rootDir,
  "src-tauri",
  "tauri.updater.generated.json",
);
const preparedReleasePath = resolve(
  rootDir,
  "release_automation",
  "prepared_release.json",
);
const tauriConfigPath = resolve(rootDir, "src-tauri", "tauri.conf.json");

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(
      `[release] Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function warnIfReleaseVersionWasNotPrepared() {
  const preparedRelease = readJsonIfExists(preparedReleasePath);
  const tauriConfig = readJsonIfExists(tauriConfigPath);
  const preparedVersion = preparedRelease?.version;
  const manifestVersion = tauriConfig?.version;

  if (!preparedVersion) {
    console.warn(
      "[release] No prepared desktop release metadata found. `npm run tauri:build` is a low-level build; use `npm run release:desktop` for release builds.",
    );
    return;
  }

  if (!manifestVersion || preparedVersion !== manifestVersion) {
    console.warn(
      `[release] Prepared version (${preparedVersion ?? "missing"}) does not match src-tauri/tauri.conf.json (${manifestVersion ?? "missing"}). Release builds should start with \`npm run release:prepare\`.`,
    );
  }
}

if (hasUpdaterConfig) {
  const configOverlay = {
    plugins: {
      updater: {
        pubkey: updaterPubkey,
        endpoints: [updaterEndpoint],
        windows: {
          installMode: "passive",
        },
      },
    },
  };

  writeFileSync(
    generatedConfigPath,
    `${JSON.stringify(configOverlay, null, 2)}\n`,
  );
}

const tauriArgs = [mode];

if (mode === "build") {
  warnIfReleaseVersionWasNotPrepared();
}

if (hasUpdaterConfig) {
  tauriArgs.push("--config", generatedConfigPath);
}

tauriArgs.push(...forwardedArgs);

const childEnv = {
  ...mergedEnv,
  VCPKG_ROOT: mergedEnv.VCPKG_ROOT || "C:\\ffmpeg\\vcpkg",
  VCPKG_DEFAULT_TRIPLET:
    mergedEnv.VCPKG_DEFAULT_TRIPLET || "x64-windows-static",
};

for (const key of Object.keys(childEnv)) {
  if (key.startsWith("VITE_")) {
    delete childEnv[key];
  }
}

if (!childEnv.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
  const privateKeyPath = childEnv.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim();
  if (privateKeyPath) {
    if (!existsSync(privateKeyPath)) {
      console.error(`Private key file not found: ${privateKeyPath}`);
      process.exit(1);
    }

    childEnv.TAURI_SIGNING_PRIVATE_KEY = readFileSync(
      privateKeyPath,
      "utf8",
    ).trim();
  }
}

const tauriCliEntrypoint = resolve(
  rootDir,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

const result = spawnSync(process.execPath, [tauriCliEntrypoint, ...tauriArgs], {
  cwd: rootDir,
  env: childEnv,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
