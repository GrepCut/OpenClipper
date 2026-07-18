# Run 1 — ścieżki wyników

**Run ID:** `e2a8618c-e053-41e3-9b1e-0b2c41ca1804`  
**Dataset ID:** `cd986c2a-d998-4a96-afec-218d052d8c78`  
**Status:** completed  
**Data:** 2026-07-18

## Wyniki benchmarku

| Co | Ścieżka |
|----|---------|
| Manifest runu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\manifest.json` |
| Szczegóły per clip/aspect | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\clips\{clipId}\{aspectId}.jsonl` |
| SQLite (metryki) | `%APPDATA%\com.openclipper.app\clipper.sqlite3` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\manifest.json
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\clips\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\clipper.sqlite3
```

## Zdjęcia wynikowe (miss frames)

| Co | Ścieżka |
|----|---------|
| Katalog JPEGów (~380 plików) | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\` |
| Manifest eksportu | `%APPDATA%\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\manifest.json` |

Pełne ścieżki (Windows):

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\miss-frames\e2a8618c-e053-41e3-9b1e-0b2c41ca1804\manifest.json
```

## Wzorzec ogólny

```
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\manifest.json
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\runs\{runId}\clips\{clipId}\{aspectId}.jsonl
%APPDATA%\com.openclipper.app\test-datasets\{datasetId}\miss-frames\{runId}\*.jpg
```
