# Run 2 — ścieżki wyników

**Run ID:** `11f509ab-9821-48be-8c34-f10debf4b322`  
**Dataset ID:** `cd986c2a-d998-4a96-afec-218d052d8c78`  
**Dataset:** Maui Test  
**Status:** completed (18/18 clipów)  
**Data:** 2026-07-18

## Wyniki benchmarku

| Co | Ścieżka |
|----|---------|
| Manifest runu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\11f509ab-9821-48be-8c34-f10debf4b322\manifest.json` |
| Szczegóły per clip/aspect | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\11f509ab-9821-48be-8c34-f10debf4b322\clips\{clipId}\{aspectId}.jsonl` |
| SQLite (metryki) | `%APPDATA%\com.openclipper.app\clipper.sqlite3` |
| Log stdout (JSON) | `benchmark-run2.log` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\11f509ab-9821-48be-8c34-f10debf4b322\manifest.json
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\11f509ab-9821-48be-8c34-f10debf4b322\clips\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\clipper.sqlite3
C:\Users\Adam\Desktop\01project_starling\open-clipper\benchmark-run2.log
```

## Zdjęcia wynikowe (miss frames)

| Co | Ścieżka |
|----|---------|
| Katalog JPEGów (668 plików) | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\11f509ab-9821-48be-8c34-f10debf4b322\` |
| Manifest eksportu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\11f509ab-9821-48be-8c34-f10debf4b322\manifest.json` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\11f509ab-9821-48be-8c34-f10debf4b322\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\11f509ab-9821-48be-8c34-f10debf4b322\manifest.json
```

## Wzorzec ogólny

```
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\manifest.json
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\clips\{clipId}\{aspectId}.jsonl
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\miss-frames\{runId}\*.jpg
```
