# Whisper Large v3 Turbo (DirectML, int8)

Model files in this folder are **not committed to git** — ONNX weights exceed GitHub's 100 MB per-file limit.

## Local dev setup

Prepare the model into `public/models/`:

```powershell
npm run models:prepare
```

Or download from the Open Clipper CDN after publication:

```text
https://models.openclipper.grepcut.com/v1/models/whisper-large-v3-turbo-dml/
```

Expected files:

- `encoder.int8.onnx`
- `decoder.int8.onnx`
- `tokens.txt`
- `config.json`

The app also downloads this model automatically on first use into `%LOCALAPPDATA%/Open Clipper/models/`. Debug builds prefer files here when present.
