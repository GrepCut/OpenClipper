# Benchmark run brief (ARG1) — authoritative visibility controller, 2026-07-19

## Current best run

- **datasetId**: `b41739b4-b6e4-4c69-b0b8-f1ba7e02a399` (name: `test1`, 6 clips)
- **runId (final)**: `2a9ffda1-180f-4102-a2ae-2724e2cf9a01`
- **comparison runId**: `a89fb1e0-b048-440f-b844-12357f357edf`
- Status: completed, 6/6 clips, 0 failures
- Analyzer: `production-smart-follow`, aspects 9-16 / 1-1 / 4-5 / 16-9

## Artifact paths

- Run manifest: `%APPDATA%\com.openclipper.app\test-datasets\b41739b4-b6e4-4c69-b0b8-f1ba7e02a399\runs\2a9ffda1-180f-4102-a2ae-2724e2cf9a01\manifest.json`
- Per-clip details: `...\runs\2a9ffda1-180f-4102-a2ae-2724e2cf9a01\clips\{clipId}\{aspectId}.jsonl`
- Strategy comparison: `...\clips\{clipId}\{aspectId}-strategy-comparison.json`
- Oracle/debug artifacts: `...\clips\{clipId}\{aspectId}-oracle.json`, `autoflip-debug.json`, `native-metrics.json`
- Verified miss-frame export for the comparison run: `%APPDATA%\com.openclipper.app\test-datasets\b41739b4-b6e4-4c69-b0b8-f1ba7e02a399\miss-frames\a89fb1e0-b048-440f-b844-12357f357edf\manifest.json` (428 frames, 24 clip/aspect results)
- Miss frames were not exported for the final run.

## Results: a89fb1e0 → 2a9ffda1

Values are averages across the same six frozen clips.

| Aspect | coverageHitRate | meanCoverageFraction | p5CoverageFraction |
|---|---:|---:|---:|
| overall | 0.7814 → **0.7974** | 0.9135 → **0.9189** | 0.6720 → **0.6723** |
| 9-16 | 0.6521 → **0.6749** | 0.8435 → **0.8518** | 0.4862 → **0.4933** |
| 1-1 | 0.7801 → **0.7994** | 0.9236 → **0.9291** | **0.6605** → 0.6520 |
| 4-5 | 0.6984 → **0.7203** | 0.8885 → **0.8961** | 0.5550 → **0.5577** |
| 16-9 | 0.9949 → 0.9949 | 0.9984 → 0.9984 | 0.9863 → 0.9863 |

Coverage reacquisition improved in every affected portrait format:

| Aspect | meanCoverageReacquisitionMs |
|---|---:|
| 9-16 | 2389 → **1978 ms** |
| 1-1 | 1470 → **1282 ms** |
| 4-5 | 1997 → **1836 ms** |
| 16-9 | 1813 → 1813 ms |

## Framing and stability guards

- Mean contain duty cycle: `0.4499 → 0.0768`; for 9-16: `0.6515 → 0.1148`.
- Median and p10 subject display height are unchanged (`0.2186` and approximately `0.117`), so coverage was not bought through blanket crop inflation.
- Mean mode switches across aspects: `8.71 → 8.61/min`.
- Mean p95 viewport-center velocity: `0.1076 → 0.0844`.
- Mean p95 viewport-center acceleration: `1.74 → 8.27`. Timestamp inspection attributes the increase to intentional teleports at hard scene cuts; the benchmark currently does not reset its acceleration state at those cuts.

## Per-clip regressions and remaining failures

- Largest hit-rate regression: `super-bass`, 1-1, `0.8510 → 0.8459` (-0.51 pp), while mean coverage improved by 0.08 pp.
- Largest tail regression: `Spring`, 1-1, p5 `0.5205 → 0.4788`; its hit-rate still improved `0.7500 → 0.7570`.
- `Full Interview MrBeast` remains the main residual failure: hit-rate is approximately `0.4518` for 9-16 and `0.5776` for 4-5. Miss frames show wrong-person/group selection rather than insufficient viewport size.
- Remaining difficult scenes include multi-person groups, animated/non-human targets, and target reacquisition immediately after dense edits.

## What changed

1. `src/features/clipper/engine/autoflip/layout-arbiter.ts`
   - Iteration 10 now treats the stateful visibility-controller result as authoritative.
   - The controller already performs identity validation, lookahead coverage, hysteresis, contain/split duration control, and a per-scene switch budget. Reapplying the older stateless evidence gates was discarding safe minimal-area crops and returning to legacy contain framing.
   - Older policies keep their existing cut, padding, reliability, stability, and coverage gates.
2. `src/features/clipper/engine/autoflip/layout-arbiter.test.ts`
   - Added coverage for authoritative Iteration 10 decisions, including cut and detected solid-background samples.
3. `src-tauri/src/video_processing/clipper_frames.rs`
   - The miss-frame exporter drains the decoder reorder buffer at EOF and falls back to the last decoded frame below the requested timestamp. This fixes exports near the end of a clip.

## Reference-algorithm findings

- `reference-algorithms/BoT-SORT/README.md` and `reference-algorithms/tracking/deep-oc-sort/README.md` informed a temporal second-person recovery experiment. The experiment produced a bit-identical benchmark and was removed from the final diff.
- `reference-algorithms/TASED-Net/README.md` supports temporal saliency as a future direction for animated/non-human targets and group attention.
- The measured improvement comes from promoting the already generated stateful visibility-controller crop, not from changing thresholds, annotations, scoring, or enlarging all viewports.

## Validation

- `npm test`: 30 test files, 116 tests passed.
- `npm run tauri:build:fast`: passed.
- Final benchmark: 6/6 clips completed, 0 failures.
- Dataset, annotations, scoring thresholds, and `reference-algorithms` were not modified.

