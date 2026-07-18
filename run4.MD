# Run 4 — ścieżki wyników

**Run ID:** `da093957-022b-45bd-8d4c-ab1e2de3d1ae`  
**Dataset ID:** `cd986c2a-d998-4a96-afec-218d052d8c78`  
**Dataset:** Maui Test  
**Status:** completed (18/18 clipów, 72 wyniki aspect)  
**Data:** 2026-07-18  
**Czas trwania:** ~7m 4s (11:24:17 → 11:31:20 UTC)

## Podsumowanie metryk

| Metryka | Wartość | Run 3 (porównanie) |
|---------|---------|---------------------|
| Średni focusHitRate | 67.3% | 63.6% |
| Średni meanFocusErrorRadius | 1.143 | 1.374 |
| Wyniki (clip × aspect) | 72 | 72 |

## Wyniki benchmarku

| Co | Ścieżka |
|----|---------|
| Manifest runu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\da093957-022b-45bd-8d4c-ab1e2de3d1ae\manifest.json` |
| Szczegóły per clip/aspect | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\da093957-022b-45bd-8d4c-ab1e2de3d1ae\clips\{clipId}\{aspectId}.jsonl` |
| SQLite (metryki) | `%APPDATA%\com.openclipper.app\clipper.sqlite3` |
| Log stderr (ONNX/FFmpeg) | `benchmark-run4.log.err` |
| JSON stdout (pełny) | `benchmark-run4.json` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\da093957-022b-45bd-8d4c-ab1e2de3d1ae\manifest.json
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\da093957-022b-45bd-8d4c-ab1e2de3d1ae\clips\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\clipper.sqlite3
C:\Users\Adam\Desktop\01project_starling\open-clipper\benchmark-run4.log.err
C:\Users\Adam\Desktop\01project_starling\open-clipper\benchmark-run4.json
```

## Zdjęcia wynikowe (miss frames)

| Co | Ścieżka |
|----|---------|
| Katalog JPEGów (668 plików) | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\da093957-022b-45bd-8d4c-ab1e2de3d1ae\` |
| Manifest eksportu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\da093957-022b-45bd-8d4c-ab1e2de3d1ae\manifest.json` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\da093957-022b-45bd-8d4c-ab1e2de3d1ae\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\da093957-022b-45bd-8d4c-ab1e2de3d1ae\manifest.json
```

Selekcja klatek: worst-50-percent-then-random-25-percent (seed = run_id).

## Wzorzec ogólny

```
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\manifest.json
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\clips\{clipId}\{aspectId}.jsonl
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\miss-frames\{runId}\*.jpg
```
