import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const scriptsDir = import.meta.dirname;
const root = join(scriptsDir, "..");
const tauriDir = join(root, "src-tauri");
const tauriConfig = join(tauriDir, "tauri.conf.json");
const msixDir = join(root, "packaging", "msix");

function findMakeAppx() {
  const pathEntry = (process.env.PATH ?? "")
    .split(";")
    .filter(Boolean)
    .map((directory) => join(directory.replace(/^"|"$/g, ""), "MakeAppx.exe"))
    .find((file) => existsSync(file));
  if (pathEntry) return resolve(pathEntry);

  const sdkRoot = process.env.WindowsSdkDir
    || join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10");
  const bin = join(sdkRoot, "bin");
  if (existsSync(bin)) {
    const sdkVersions = readdirSync(bin)
      .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    for (const sdkVersion of sdkVersions) {
      const file = join(bin, sdkVersion, "x64", "MakeAppx.exe");
      if (existsSync(file)) return file;
    }
  }

  throw new Error("MakeAppx.exe was not found. Install a Windows 10 or 11 SDK.");
}

function run(executable, args, env = process.env) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${args[0]} failed (${result.signal ?? result.status}).`);
  }
}

function buildMsix() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("This MSIX release requires Windows and an x64 Node.js installation.");
  }

  const makeAppx = findMakeAppx();
  const { values } = parseArgs({ options: { version: { type: "string" } } });
  const current = JSON.parse(readFileSync(tauriConfig, "utf8")).version;
  if (values.version !== undefined && values.version !== current) {
    run("python", [
      join(root, "release_automation", "release_manager.py"),
      "prepare",
      "--version",
      values.version,
    ]);
  }

  const { version } = JSON.parse(readFileSync(tauriConfig, "utf8"));
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const cargoToml = readFileSync(join(tauriDir, "Cargo.toml"), "utf8");
  const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (version !== packageJson.version || version !== cargoVersion) {
    throw new Error("App versions disagree. Run npm run release:prepare to synchronize them.");
  }
  if (!/^[1-9]\d*\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)
    || version.split(".").some((part) => Number(part) > 65535)) {
    throw new Error(`Cannot use app version "${version}" in an MSIX package.`);
  }

  const msixVersion = `${version}.0`;
  const outDir = join(msixDir, "out");
  const packagePath = join(outDir, `OpenClipper_${msixVersion}_x64.msix`);
  const target = resolve(tauriDir, process.env.CARGO_TARGET_DIR || "target");
  const env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_PROFILE: "release" };

  run(process.execPath, [join(scriptsDir, "run-tauri.mjs"), "build", "--no-bundle"], env);

  mkdirSync(outDir, { recursive: true });
  const stage = mkdtempSync(join(outDir, ".stage-"));
  try {
    const payload = join(stage, "payload");
    const assets = join(payload, "Assets");
    mkdirSync(assets, { recursive: true });

    for (const name of ["open-clipper.exe", "open-clipper-mcp.exe"]) {
      copyFileSync(join(target, "release", name), join(payload, name));
    }
    run(process.execPath, [join(scriptsDir, "stage-windows-runtime-dlls.mjs"), payload], env);
    cpSync(
      join(tauriDir, "resources", "models", "clipper-vision"),
      join(payload, "resources", "models", "clipper-vision"),
      { recursive: true },
    );
    for (const name of ["StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png"]) {
      copyFileSync(join(tauriDir, "icons", name), join(assets, name));
    }

    const manifest = readFileSync(join(msixDir, "AppxManifest.template.xml"), "utf8");
    writeFileSync(join(payload, "AppxManifest.xml"), manifest.replace("@VERSION@", msixVersion));

    const stagedPackage = join(stage, "OpenClipper.msix");
    run(makeAppx, ["pack", "/d", payload, "/p", stagedPackage]);
    renameSync(stagedPackage, packagePath);
    console.log(`\nMicrosoft Store package: ${packagePath}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

try {
  buildMsix();
} catch (error) {
  console.error(`[release:msix] ${error.message}`);
  process.exitCode = 1;
}
