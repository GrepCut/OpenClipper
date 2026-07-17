# NeMo Parakeet TDT 0.6B (int8)

Model files in this folder are **not committed to git** — `encoder.int8.onnx` alone is ~622 MB (GitHub limit: 100 MB per file).

## Local dev setup

Download and extract the sherpa-onnx release archive into this directory:

```text
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2
```

Expected files after extraction:

- `encoder.int8.onnx`
- `decoder.int8.onnx`
- `joiner.int8.onnx`
- `tokens.txt`
- `manifest.json` (optional; app validates via SHA-256 in cache)

The app also downloads this model automatically on first use into `%LOCALAPPDATA%/Open Clipper/models/`. Debug builds prefer files here when present.

`test_wavs/` is for local smoke tests only (see `src-tauri/examples/parakeet_smoke.rs`).
