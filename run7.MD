# Run 7 — adaptive framing and model candidates

Date: 2026-07-18

## Immutable floor

- Reference run: `dc20866a-b36d-4c37-b314-ba8da33f04b8`
- 9:16 focus: 69.25%
- 9:16 visibility: 90.91%
- 9:16 dual-target: 35.01%

No candidate in this iteration is promoted and the floor remains Run 6.

## Adaptive single-crop replay

Run 6 replay self-check reproduced the recorded run exactly. The new replay
recomputed semantic viewport geometry across 96 global, clip-independent
configurations. The best tested candidate reached 68.89% focus, 89.83%
visibility and 34.82% dual-target, so adaptive zoom remains shadow-only.

Reports:

- `benchmark-replays/run7-framing-sweep.json`
- `benchmark-replays/run7-framing-sweep-expanded.json`
- 616 exported Run 6 miss frames under `benchmark-replays/run6-miss-frames`

## YOLOX-Tiny shadow

- Source SHA-256: `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7`
- Derived WinML SHA-256: `e7556b815abedd1a50eddc7ee92a32ca264182dc35367656f0757c838f036385`
- Shadow run after giving SSD and YOLOX equivalent ByteTrack treatment:
  `9d66826a-2a8b-4bf3-b2eb-bb0c6abb8d80`
- 9:16 detector candidate: focus 68.33%, visibility 89.95%, dual-target 35.01%

YOLOX does not pass the Run 6 focus or visibility floors. The `ssd` production
default is unchanged; `yolox-shadow` and `yolox-primary` remain explicit
diagnostic modes, with SSD fallback on a primary model failure.

## Light-ASD preparation

- AVA source SHA-256: `d44bc3ea7baa8e0946fa3921311714a630ed8b90a1928fab0dbe30d918909317`
- Derived WinML SHA-256: `a7921c52195888a960aa3b592927a95c9c47d63a800787def487f48b10c2f1cf`
- PyTorch/ONNX maximum absolute error: `1.1175871e-8`
- Dynamic time was exercised in ONNX Runtime for 1–6 seconds and the two-input
  graph was evaluated successfully through WinML.

Face ByteTrack IDs are now retained. Active-speaker evidence is accepted only
after five consecutive multi-face samples, must beat the configured threshold
and runner-up margin, and can only strengthen an existing observed face track.
The conditional 25 FPS audio/video extraction remains behind the YOLOX/model
promotion gates and was not benchmarked in this iteration.

## Validation

- frontend production build: passed
- Rust `cargo check`: passed
- YOLOX decoder and WinML model tests: passed
- Light-ASD named-input WinML test: passed
- Run 6 replay self-check: passed
- Maui shadow benchmark: 18/18 clips, zero errors

Only Maui Test is available locally. A new floor must not be declared without
a second previously unused validation dataset.
