# Run 5 — detector segment router sweep (offline replay)

Data: 2026-07-19. Source: offline sweep log (`Untitled-1.txt`).

## Decision

Best router candidate from replay sweep:

- **coverageHitRate overall:** 82.18% (baseline 79.74%)
- **9:16:** 71.93% (+4.44 pp vs baseline 67.49%)
- **Worst cell delta:** −0.57 pp (gate < −2.00 pp)
- **LOCO:** 6/6 identical params per fold
- **Gates:** PASS (switches/min 8.61, contain 7.68%)

## Best params (now default in `segment-detector-router.ts`)

```json
{
  "segmentDurationSec": 0.6,
  "minimumFaceSupport": 0.05,
  "minimumPersistence": 0.45,
  "minimumPersonExcess": 0.5,
  "enterScore": 1.0,
  "exitScore": 0.75,
  "minimumHoldSec": 0.4,
  "maxSwitchesPerMinute": 8
}
```

## Per-clip 9:16 deltas (detector frame share)

| Clip | Delta | Detector % |
|---|---:|---:|
| Full Interview MrBeast | +7.51 pp | 38.9% |
| export_2026-07-15 | +8.21 pp | 39.3% |
| super-bass | +7.58 pp | 61.7% |
| medium | +1.08 pp | 35.5% |
| Spring (Blender) | +2.23 pp | 7.8% |
| snowboarding | 0.00 pp | 0.0% |

## Follow-up

Router + splice integrated in production path. Generalization work continues under `handoff_generalization.MD` (shadow models, cohort infra, hypothesis bank authority flag).
