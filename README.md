# Open Clipper

Desktop app scaffold: **Tauri 2** + **React 19** + **TypeScript** + **Vite 7**.

## Prerequisites

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
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

Local Parakeet transcription can use GPU via DirectML. The ONNX model files live under `public/models/mediapipe/nemo-parakeet-tdt-0.6b-v3-int8/` (used automatically in debug builds when present).

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
