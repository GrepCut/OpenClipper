import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";

const EXCLUDED_DLLS = new Set([
  "directml.debug.dll",
  "tauri_app_lib.dll",
]);

const REQUIRED_DLLS = [
  "sherpa-onnx-c-api.dll",
  "onnxruntime_ort.dll",
  "DirectML.dll",
];

const root = join(import.meta.dirname, "..");
const tauriDir = join(root, "src-tauri");
const profile =
  process.env.CARGO_BUILD_PROFILE ?? process.env.CARGO_PROFILE ?? "release";
const targetDirName = process.env.CARGO_TARGET_DIR ?? "target";
const targetRoot = isAbsolute(targetDirName)
  ? targetDirName
  : join(tauriDir, targetDirName);
const profileDir = join(targetRoot, profile);
const destDir = join(tauriDir, "resources", "win-runtime");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== "win32") {
  console.log("Skipping Windows runtime DLL staging on non-Windows platform.");
  process.exit(0);
}

if (!existsSync(profileDir)) {
  fail(
    `Cannot stage Windows runtime DLLs: profile directory missing at ${profileDir}. ` +
      "Run a release build before bundling.",
  );
}

const sourceDlls = readdirSync(profileDir).filter((name) =>
  name.toLowerCase().endsWith(".dll"),
);

if (sourceDlls.length === 0) {
  fail(
    `No DLL files found in ${profileDir}. ` +
      "Ensure sherpa DirectML libs are built (npm run sherpa:directml) and rebuild.",
  );
}

const staged = [];
for (const name of sourceDlls) {
  if (EXCLUDED_DLLS.has(name.toLowerCase())) {
    continue;
  }

  const source = join(profileDir, name);
  mkdirSync(destDir, { recursive: true });
  const destination = join(destDir, name);
  copyFileSync(source, destination);
  staged.push(name);
}

if (staged.length === 0) {
  fail(`No runtime DLLs staged from ${profileDir} after exclusions.`);
}

const missingRequired = REQUIRED_DLLS.filter(
  (name) => !staged.includes(name),
);
if (missingRequired.length > 0) {
  fail(
    `Missing required runtime DLL(s) in ${profileDir}: ${missingRequired.join(", ")}.\n` +
      "For sherpa: npm run sherpa:directml\n" +
      "For ORT 1.23: place Microsoft.ML.OnnxRuntime.DirectML 1.23.0 under third_party/onnxruntime-directml/",
  );
}

console.log(`Staged ${staged.length} Windows runtime DLL(s) to ${destDir}`);
for (const name of staged.sort()) {
  console.log(` - ${name}`);
}
