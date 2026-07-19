# Benchmark run brief (ARG1) — coverage-first framing, 2026-07-19

## Current best run

- **datasetId**: `b41739b4-b6e4-4c69-b0b8-f1ba7e02a399` (name: "test1", 6 clips)
- **runId (final)**: `a89fb1e0-b048-440f-b844-12357f357edf`
- **baseline runId (before changes)**: `d0e9d23b-3740-469c-943f-c13c6fbf7d0f`
- Analyzer: `production-smart-follow`, aspects 9-16 / 1-1 / 4-5 / 16-9

## Artifact paths

- Run manifest: `%APPDATA%\com.openclipper.app\test-datasets\b41739b4-b6e4-4c69-b0b8-f1ba7e02a399\runs\a89fb1e0-b048-440f-b844-12357f357edf\manifest.json`
- Per-clip details: `...\runs\<runId>\clips\{clipId}\{aspectId}.jsonl` (selected track), `{aspectId}-strategy-comparison.json` (selected/baseline/semantic/detector/iteration10 metrics), `{aspectId}-oracle.json`, `autoflip-debug.json`
- Miss frames (baseline run only): `%APPDATA%\com.openclipper.app\test-datasets\b41739b4-...\miss-frames\d0e9d23b-3740-469c-943f-c13c6fbf7d0f\`
  - NOTE: `--extract-miss-frames a89fb1e0-...` currently fails with `Error: No frame found near 119.333s` (seek-near-clip-end bug in `benchmark_miss_export.rs`) — fix before relying on fresh exports.

## Results: baseline d0e9d23b → final a89fb1e0

| Aspect | coverageHitRate | meanCoverageFraction | p5CoverageFraction |
|---|---|---|---|
| overall | 0.400 → **0.781** | 0.760 → **0.914** | 0.393 → **0.672** |
| 16-9 | 0.452 → 0.995 | 0.780 → 0.998 | 0.397 → 0.986 |
| 1-1 | 0.432 → 0.780 | 0.786 → 0.924 | 0.405 → 0.660 |
| 4-5 | 0.379 → 0.698 | 0.762 → 0.888 | 0.398 → 0.555 |
| 9-16 | 0.337 → 0.652 | 0.714 → 0.844 | 0.372 → 0.486 |

Per-clip coverageHitRate (9-16), baseline → final: afebe13d 0.00→0.94, 03515d95 0.06→0.76, c802a69f 0.31→0.41, 724ed001 0.49→0.55, b02a7ed9 0.52→0.62, c3288774 0.64→0.64.

No regressions vs baseline (worst cell delta −0.01, noise). medianSubjectDisplayHeightFraction dropped 0.30→0.22 — inherent to matching the dataset's full-height GT convention (all crop-intent GT rects have h=1.00), not blanket zoom-out.

## What changed (code, commit-pending)

1. `build-autoflip-track.ts` — removed salience zoom (window never below nominal cover crop; matches stock AutoFlip `scene_camera_motion_analyzer.cc` in reference-algorithms/mediapipe); added `expandCropAcrossBars` (extend windows across static letterbox/pillarbox bars + floor at source-space nominal size).
2. `frame-draw.ts` `resolveClipperLayoutRender` — layout tracks authoritative for legacy-baseline frames too (kills lossy auto-collage: half-height panels were 0% hit).
3. `smart-crop.ts` comment + `build-autoflip-track.test.ts` updated (matched-aspect = full-frame passthrough).

## Known failure patterns / next directions

- Residual 9-16/4-5 misses are **single-crop frames where the scene window is too narrow because the 2nd/3rd person was never detected as a region** (multi-person wide GT: c802a69f, 724ed001, c3288774). Verified: adding all detected humans to arbiter coverageRegions was a bit-identical no-op (run ede90ef4) — this is a detection/fusion gap, not arbitration. Next levers: multi-person detection/re-id (BoT-SORT / Deep-OC-SORT / deep-person-reid in reference-algorithms) or video saliency (ViNet / TASED-Net) to size windows to attended regions.
- Reacquisition tails (p5): mean reacquisition 1–6 s on laggard clips; cut-boundary x-tracking lag.
- Oracle jsonl is aspect-constrained and NOT an upper bound for wide-window strategies (724ed001 9-16 oracle 0.00 vs selected 0.55) — don't calibrate against it.
- Dataset GT conventions: every crop-intent GT rect is full-height 9:16; contain-intent GT rects are full-height bands 0.3–1.0 wide; letterboxed sources annotate GT **including** the bars, so crops must span static bars (dead pixels, native look) rather than blur-pad within contentRect.
