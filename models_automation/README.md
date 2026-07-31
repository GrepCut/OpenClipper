# Models Automation

Independent, verified Open Clipper model set for manual publication to
Cloudflare R2 at `https://models.openclipper.grepcut.com/v1`.

Automation publishes production ASR files: Parakeet and Whisper Large v3
Turbo DirectML. Test WAVs, README, and native
`src-tauri/resources/models/clipper-vision` are not uploaded to the CDN.

```powershell
npm run models:prepare
npm run models:verify
npm run models:promote
```

Upload the contents of `models_automation/r2_mirror/` to the bucket, preserving
the `v1/` prefix. Publish `v1/models/...` files first, then
`v1/model-manifest.json`; after each change, invalidate the manifest cache.

Local development always uses `public/models`. Production web fetches
models directly from the CDN, and production Tauri uses a local,
verified cache.

## WinML bundle (`clipper-vision`)

Generalization models (OSNet, TransNetV2, ViNet) are not included in `r2_mirror`.
Tauri WinML loads them from `src-tauri/resources/models/clipper-vision/`, bundled
at build time. After changing ONNX files in `public/models/`, run:

```powershell
npm run clipper-vision:sync
npm run tauri:build:fast
```
