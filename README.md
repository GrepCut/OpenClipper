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
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

## Status

**Open Clipper is in active development.** The desktop app focuses on turning long-form footage into short clips you can publish:

- Smart crop and subject tracking for vertical and social formats
- Local speech-to-text (Whisper, Parakeet) with optional GPU acceleration on Windows
- Export pipeline with metadata, transcripts, and multi-platform publishing
- MCP server so AI agents can list exports and work with your clip library
- Tauri desktop app with a React UI — models download on demand into local cache

Try the product at [grepcut.com](https://grepcut.com/). Source and issues live in [GrepCut/OpenClipper](https://github.com/GrepCut/OpenClipper).

## Prerequisites

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

## Development

```bash
npm install
npm run tauri:dev
```

## Build

Shortest loop for local desktop testing (no installer bundle):

```bash
npm run tauri:build:preview:fast
```

Full build with installer bundles:

```bash
npm run tauri:build
```

`npm run tauri:preview` and `npm run tauri:preview:fast` run a previously built EXE from the release output. The fast variant uses lighter Cargo flags and skips the installer. Production Tauri builds do not copy models from `public/models` into `dist` — the app downloads them on demand into its own model cache.

## Faster builds on Windows

You can optionally exclude only the Open Clipper Cargo cache from Windows Defender. Run **PowerShell as administrator** from the project root:

```powershell
$target = (Resolve-Path .\src-tauri\target).Path
Add-MpPreference -ExclusionPath $target
(Get-MpPreference).ExclusionPath -contains $target
```

To undo:

```powershell
$target = (Resolve-Path .\src-tauri\target).Path
Remove-MpPreference -ExclusionPath $target
```

## Stack

| Layer | Version |
|-------|---------|
| Tauri | 2.x |
| React | 19.x |
| Vite | 7.x |
| TypeScript | 5.8.x |

Bundle identifier: `com.openclipper.app`

## Parakeet DirectML (Windows)

Local Parakeet transcription can use GPU via DirectML. ONNX model files live under `public/models/nemo-parakeet-tdt-0.6b-v3-int8/` (used automatically in debug builds when present).

The default `sherpa-onnx` prebuilt libraries are CPU-only. To enable DirectML:

1. Install **Visual Studio 2022** with the **Windows 10 SDK**
2. Build native libs (one-time, ~15–30 min):

```bash
npm run sherpa:directml
```

3. Rebuild the app so Cargo links the custom libs:

```bash
cd src-tauri && cargo clean && cd ..
npm run tauri:dev
```

Cargo reads `SHERPA_ONNX_LIB_DIR` from [`src-tauri/.cargo/config.toml`](src-tauri/.cargo/config.toml) after the build script adds it automatically.

Override the model directory with `PARAKEET_MODEL_DIR` if needed.

## Contributing

Questions, bug reports, and feature ideas are welcome. [Join the Discord](https://discord.gg/2uXgrUpe) or [open an issue](https://github.com/GrepCut/OpenClipper/issues). Please follow our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) — Copyright 2026 GrepCut
