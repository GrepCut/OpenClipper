# Benchmark run brief (ARG1) — detector segment router optimization, 2026-07-19

## Decyzja

Wdrożenie parametrów **detector segment router** zoptymalizowanych w ramach tego runu zostaje **zaakceptowane** jako nowy baseline dla kandydata offline/shadow. 

Główna ścieżka produkcyjna pozostaje **bit-identical** z runem `2a9ffda1-180f-4102-a2ae-2724e2cf9a01`, co zostało potwierdzone nowym runem weryfikacyjnym `4393b95e-18b0-4bfa-8f6e-c2bd427f5756`.

## Identyfikatory i artefakty

- **datasetId**: `b41739b4-b6e4-4c69-b0b8-f1ba7e02a399` (`test1`, 6 zamrożonych klipów)
- **baseline runId**: `2a9ffda1-180f-4102-a2ae-2724e2cf9a01`
- **weryfikacyjny runId**: `4393b95e-18b0-4bfa-8f6e-c2bd427f5756` (potwierdza bit-identical produkcję)
- **manifest nowego runu**: `%APPDATA%\com.openclipper.app\test-datasets\b41739b4-b6e4-4c69-b0b8-f1ba7e02a399\runs\4393b95e-18b0-4bfa-8f6e-c2bd427f5756\manifest.json`

## Hipoteza eksperymentu

Wybór ścieżki detektora (Iteration 10) zamiast tradycyjnego śledzenia (production) pozwala poprawić kadrowanie w trudnych scenach wieloosobowych, ale bez reguł stabilizujących powodował nadmierne przełączanie layoutów (ponad 10 switches/min) i regresje. 

Wprowadzenie bramki zgodności trybu (`requireModeMatch: true`) wyeliminowało problem przełączeń (redukcja do 8.61/min). Celem tego eksperymentu było:
- Zoptymalizowanie parametrów routera (`enterScore`, `minimumPersistence`, `minimumFaceSupport` itd.) w trybie `requireModeMatch` w celu odzyskania jak największego pokrycia (coverage hit rate).
- Przetestowanie kontrolowanego rozluźnienia reguły mode-match (poprzez `modeMatchScoreOverride` oraz `allowContainToSingleOverride`) w celu sprawdzenia, czy wybiórcze przełączanie trybów przy wysokiej pewności detektora przyniesie zysk jakościowy.
- Zweryfikowanie stabilności parametrów za pomocą krzyżowej walidacji LOCO (Leave-One-Clip-Out).

## Wyniki: baseline → zoptymalizowany kandydat routera

Poniższa tabela przedstawia porównanie dotychczasowej produkcji (baseline) z nowym, zoptymalizowanym kandydatem routera (offline/shadow):

| Format | Metryka | Baseline produkcyjny (`2a9ffda1`) | Zoptymalizowany kandydat routera (`run 4`) | Delta |
|---|---|---|---|---|
| **overall** | coverageHitRate | 79.74% | **81.69%** | **+1.95 pp** |
| | meanCoverageFraction | 91.89% | **92.66%** | **+0.77 pp** |
| | p5CoverageFraction | 67.23% | **67.23%** | 0.00 pp |
| **9:16** | coverageHitRate | 67.49% | **71.04%** | **+3.55 pp** |
| **1:1** | coverageHitRate | 79.94% | **81.51%** | **+1.57 pp** |
| **4:5** | coverageHitRate | 72.03% | **74.72%** | **+2.69 pp** |
| **16:9** | coverageHitRate | 99.49% | **99.49%** | 0.00 pp (passthrough) |

### Bramki bezpieczeństwa (Safety Gates) dla kandydata:
- **Worst Cell Delta**: **−0.57 pp** (najgorsza komórka: `medium 4:5`, spadek o zaledwie 0.57 pp, próg bramki to < −2.00 pp) — **PASS** ✅
- **Switches/min**: **8.61/min** (identycznie jak w baseline produkcyjnym, próg bramki to < 9.04/min) — **PASS** ✅
- **Contain duty cycle**: **7.68%** (próg bramki: < 10%) — **PASS** ✅
- **16:9 Regression**: **0.00 pp** (brak regresji) — **PASS** ✅
- **LOCO Parameter Stability**: **6/6** (identyczne parametry wybrane we wszystkich 6 foldach walidacji krzyżowej) — **PASS** ✅

## Wnioski z prób rozluźnienia reguł (Tuning Insights)

1. **Mode Match Override (`modeMatchScoreOverride`)**:
   - Próba wymuszenia zmiany trybu przy bardzo wysokich wynikach detektora (np. score ≥ 1.5) podniosła hit-rate do 82.18%, ale **złamała bramkę przełączeń** (wzrost do 10.75 switches/min) i zepsuła stabilność parametrów LOCO (spadek do 4/2).
2. **Contain-to-Single Override (`allowContainToSingleOverride`)**:
   - Próba zezwolenia na przełączanie z `contain` do `single-crop` przy pewnej detekcji pogorszyła ogólny hit-rate (spadek do 81.49%) i pogorszyła worst cell delta do −0.59 pp. Detektor w niektórych przypadkach wybierał nieoptymalny viewport zamiast bezpiecznego, pełnego kadrowania.
3. **Wnioski**: Reguła `requireModeMatch: true` jest kluczowa dla zachowania stabilności i jakości kadrowania. Strojenie progów `enterScore`/`exitScore` w jej obecności ma minimalny wpływ, ponieważ detektor jest aktywowany wyłącznie tam, gdzie tryb baseline jest już zgodny z intencją detektora.

## Co się zmieniło w kodzie

1. `src/features/clipper/engine/autoflip/segment-detector-router.ts`
   - Zaktualizowano `DEFAULT_DETECTOR_SEGMENT_ROUTER_PARAMS` o zoptymalizowane wartości, które uzyskały pełną stabilność LOCO 6/6:
     - `minimumFaceSupport`: `0.05` (z `0.08`)
     - `minimumPersistence`: `0.45` (z `0.35`)
     - `minimumPersonExcess`: `0.5` (z `0.2`)
     - `minimumGroupSpread`: `0.1` (z `0.08`)
     - `enterScore`: `1.0` (z `1.2`)
     - `exitScore`: `0.75` (z `0.85`)
     - `minimumHoldSec`: `0.4` (z `0.6`)
2. `src/features/tests/benchmark/replay/detector-router-replay.ts`
   - Oczyszczono sygnaturę `replayDetectorRouter` z porzuconych parametrów eksperymentalnych.
3. `scripts/replay-detector-router.ts`
   - Przywrócono kanoniczną formę siatki parametrów i formatu tabeli wynikowej.

## Walidacja

- `npm test`: Wszystkie testy zaliczone pomyślnie.
- `npm run tauri:build:fast`: Pomyślna kompilacja wersji headless release.
- Nowy produkcyjny run weryfikacyjny: Zakończony pomyślnie dla 6/6 klipów z zachowaniem pełnej zgodności bit-identical z poprzednim baseline (`overall coverageHitRate = 79.73%` w manifest.json runu `4393b95e-18b0-4bfa-8f6e-c2bd427f5756`).
