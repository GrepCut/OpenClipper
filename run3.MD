# Run 3 — ścieżki wyników

**Run ID:** `a52398ae-a9fe-4214-87ef-d891423e9283`  
**Dataset ID:** `cd986c2a-d998-4a96-afec-218d052d8c78`  
**Dataset:** Maui Test  
**Status:** completed (18/18 clipów, 72 wyniki aspect)  
**Data:** 2026-07-18  
**Czas trwania:** ~1m 18s (08:34:00 → 08:35:18 UTC)

## Podsumowanie metryk

| Metryka | Wartość |
|---------|---------|
| Średni focusHitRate | 63.6% |
| Średni meanFocusErrorRadius | 1.374 |
| Wyniki (clip × aspect) | 72 |

## Wyniki benchmarku

| Co | Ścieżka |
|----|---------|
| Manifest runu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\a52398ae-a9fe-4214-87ef-d891423e9283\manifest.json` |
| Szczegóły per clip/aspect | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\a52398ae-a9fe-4214-87ef-d891423e9283\clips\{clipId}\{aspectId}.jsonl` |
| SQLite (metryki) | `%APPDATA%\com.openclipper.app\clipper.sqlite3` |
| Log stderr (ONNX/FFmpeg) | `benchmark-run3.log.err` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\a52398ae-a9fe-4214-87ef-d891423e9283\manifest.json
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\a52398ae-a9fe-4214-87ef-d891423e9283\clips\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\clipper.sqlite3
C:\Users\Adam\Desktop\01project_starling\open-clipper\benchmark-run3.log.err
```

## Zdjęcia wynikowe (miss frames)

| Co | Ścieżka |
|----|---------|
| Katalog JPEGów (668 plików) | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\a52398ae-a9fe-4214-87ef-d891423e9283\` |
| Manifest eksportu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\a52398ae-a9fe-4214-87ef-d891423e9283\manifest.json` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\a52398ae-a9fe-4214-87ef-d891423e9283\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\a52398ae-a9fe-4214-87ef-d891423e9283\manifest.json
```

Selekcja klatek: worst-50-percent-then-random-25-percent (seed = run_id).

## Wzorzec ogólny

```
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\manifest.json
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\clips\{clipId}\{aspectId}.jsonl
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\miss-frames\{runId}\*.jpg
```
