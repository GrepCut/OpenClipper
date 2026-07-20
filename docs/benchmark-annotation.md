# Benchmark annotation convention

Ground-truth annotations for Open Clipper test datasets follow these rules (handoff §5.1).

## Crop targets (default)

- Annotate in **source pixel space** before any reframing.
- Each crop target is a **full-height 9:16 rectangle** (`layoutIntent: "crop"`).
- Podcast / talking-head: box around the **face or upper body** of the speaker.
- Action / sport / animation: box around the **center of action** (rider, character, focal motion).

## Contain targets

- Use `layoutIntent: "contain"` when the correct output should show the full active frame with bars.
- One free-aspect **visibility rect** per keyframe.

## Cohorts

Tag every clip with one or more cohorts (see `src/features/tests/benchmark/cohort-tags.ts`):

| Cohort | Examples |
|---|---|
| `talking-head` | podcast, single presenter |
| `multi-person-interview` | 3+ people, panel |
| `music-video` | dance, performance |
| `sport-fast` | snowboarding, handheld action |
| `animation` | non-human, CGI |
| `screen-gameplay` | facecam + gameplay |
| `vlog-handheld` | selfie vlog |
| `concert-crowd` | stage + audience |
| `letterbox` | cinematic bars |
| `vertical-source` | native vertical footage |
| `low-quality` | heavy compression |

Store tags in `test_clips.cohort_tags_json` as a JSON string array.

## Holdout

- Create a separate dataset with `datasetRole: "holdout"`.
- Never use holdout clips for tuning, replay sweeps, or miss-frame debugging (this is a process discipline, not an enforced CLI gate).

## Scoring (immutable)

- Hit when `coverageFraction ≥ 0.85` per target (`COVERAGE_HIT_THRESHOLD`).
- Zoom-out to buy coverage is forbidden in production scoring.
