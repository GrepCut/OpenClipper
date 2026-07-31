<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="public/clipper/clipper-logo.png" alt="Open Clipper logo" width="100" />
    </td>
    <td align="right">
      <h1>Open Clipper</h1>
      <h3 style="margin-top: -10px;">AI-powered video clipping and publishing by <a href="https://grepcut.com/">GrepCut</a>.</h3>
    </td>
  </tr>
</table>

[![Website](https://img.shields.io/badge/website-grepcut.com-111?logo=google-chrome&logoColor=fff&style=flat)](https://grepcut.com/)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=fff&style=flat)](https://discord.gg/2uXgrUpe)
[![X](https://img.shields.io/badge/follow-%40GrepCut-000?logo=x&logoColor=fff&style=flat)](https://x.com/GrepCut)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Adam%20Zi%C3%B3%C5%82ko-0A66C2?logo=linkedin&logoColor=fff&style=flat)](https://www.linkedin.com/in/adam-zi%C3%B3%C5%82ko-9b6603351/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

## Status

**Open Clipper is in active development.** The desktop app focuses on turning long-form footage into short clips you can publish:

- Smart crop and subject tracking for vertical and social formats
- Local speech-to-text (Whisper, Parakeet) with optional GPU acceleration on Windows
- Export pipeline with metadata, transcripts, and multi-platform publishing
- MCP server so AI agents can list exports and work with your clip library
- Tauri desktop app with a React UI — models download on demand into `%APPDATA%\com.openclipper.app\models\`

Try the product at [grepcut.com](https://grepcut.com/). Source and issues live in [GrepCut/OpenClipper](https://github.com/GrepCut/OpenClipper).

## Prerequisites

Windows is the primary development target today.

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install) **≥ 1.91**
- [Visual Studio 2022](https://visualstudio.microsoft.com/) or [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Windows 10 SDK**
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (required by Tauri 2 on Windows)
- Static **FFmpeg** via [vcpkg](https://vcpkg.io/) (`x64-windows-static`). The repo expects paths in [`src-tauri/.cargo/config.toml`](src-tauri/.cargo/config.toml) — adjust `VCPKG_ROOT`, `FFMPEG_DIR`, and the MSVC `linker` path for your machine.

## Development

```bash
npm install
npm run tauri:dev
```

`tauri:dev` starts Vite on `http://localhost:1420` via `beforeDevCommand`. Close any running `open-clipper.exe` before rebuilding to avoid file locks.

## Build

| Goal | Command | Output |
|------|---------|--------|
| Fast release EXE (no installer) | `npm run tauri:build:fast` | `src-tauri/target-fast/release/open-clipper.exe` |
| Fast build + launch | `npm run tauri:build:preview:fast` | same EXE, then starts it |
| Full build with installers | `npm run tauri:build` | `src-tauri/target/release/` + bundles |
| Launch existing EXE only | `npm run tauri:preview` | `src-tauri/target/release/open-clipper.exe` |
| Launch existing fast EXE | `npm run tauri:preview:fast` | `src-tauri/target-fast/release/open-clipper.exe` |

`tauri:build:fast` uses lighter Cargo flags (`LTO=off`, `opt-level=2`) and a separate `target-fast/` cache. Production builds run `beforeBuildCommand` (`build:tauri` + MCP staging); models from `public/models` are not copied into `dist` — the app downloads them on demand into AppData.

## Faster builds on Windows

You can optionally exclude the Open Clipper Cargo caches from Windows Defender. Run **PowerShell as administrator** from the project root:

```powershell
$target = (Resolve-Path .\src-tauri\target).Path
Add-MpPreference -ExclusionPath $target
(Get-MpPreference).ExclusionPath -contains $target

$targetFast = Join-Path (Resolve-Path .\src-tauri).Path "target-fast"
if (Test-Path $targetFast) {
  Add-MpPreference -ExclusionPath $targetFast
}
```

To undo:

```powershell
$target = (Resolve-Path .\src-tauri\target).Path
Remove-MpPreference -ExclusionPath $target

$targetFast = Join-Path (Resolve-Path .\src-tauri).Path "target-fast"
if (Test-Path $targetFast) {
  Remove-MpPreference -ExclusionPath $targetFast
}
```

## MCP

Open Clipper exposes export metadata to AI agents over two transports:

| Transport | When it works | Endpoint |
|-----------|---------------|----------|
| **HTTP** | Desktop app is running | `http://127.0.0.1:12742/mcp` (override with `OPEN_CLIPPER_MCP_PORT`) |
| **Stdio** | Separate `open-clipper-mcp` process, no GUI | Full path to the staged binary (preferred in Cursor) |

Both transports read the same SQLite database (`%APPDATA%\com.openclipper.app\clipper.sqlite3`, or `OPEN_CLIPPER_DB_PATH`).

**Tools:** `list_exports`, `get_export_details`, `patch_export_social_metadata`

**Cursor setup:** Prefer stdio over the HTTP URL — it avoids OAuth/`mcp_auth` gating. The **MCP** tab in the app copies a ready-made JSON snippet with the correct binary path.

**Build the stdio binary:**

```bash
node scripts/stage-open-clipper-mcp.mjs
```

This runs automatically during `tauri:build` and `tauri:build:fast` (via `beforeBuildCommand`), but **not** during `tauri:dev`. Output: `src-tauri/bin/open-clipper-mcp-<triple>.exe`.

## Stack

| Layer | Version |
|-------|---------|
| Tauri | 2.x |
| React | 19.x |
| Vite | 7.x |
| TypeScript | 5.8.x |

Bundle identifier: `com.openclipper.app`

## Models

ASR models (Parakeet, Whisper) download on first use into `%APPDATA%\com.openclipper.app\models\`. For local dev without CDN, place files under `public/models/<model-id>/` (see per-model READMEs there).

WinML vision models ship in `src-tauri/resources/models/clipper-vision/`. After editing ONNX in `public/models/`, run `npm run clipper-vision:sync` before building.

CDN publishing workflow: [`models_automation/README.md`](models_automation/README.md).

## Parakeet DirectML (Windows)

Local Parakeet transcription can use GPU via DirectML. Debug builds prefer ONNX files under `public/models/nemo-parakeet-tdt-0.6b-v3-int8/` when present; production uses the AppData cache (or `PARAKEET_MODEL_DIR` / `SHERPA_ONNX_MODEL_DIR`).

The default `sherpa-onnx` prebuilt libraries are CPU-only. To enable DirectML:

1. Install **Visual Studio 2022** with the **Windows 10 SDK**, plus **CMake** and **Git**
2. Build native libs (one-time, ~15–30 min):

```bash
npm run sherpa:directml
```

3. Rebuild the app so Cargo links the custom libs:

```bash
cd src-tauri && cargo clean && cd ..
npm run tauri:dev
```

`npm run sherpa:directml` writes `SHERPA_ONNX_LIB_DIR` to [`src-tauri/.cargo/config.toml`](src-tauri/.cargo/config.toml) pointing at `third_party/sherpa-onnx-directml/install/lib`.

## Contributing

Questions, bug reports, and feature ideas are welcome. [Join the Discord](https://discord.gg/2uXgrUpe) or [open an issue](https://github.com/GrepCut/OpenClipper/issues). Please follow our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) — Copyright 2026 GrepCut
