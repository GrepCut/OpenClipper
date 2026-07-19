# Benchmark run brief (ARG1) — odrzucona próba content-aware crop, 2026-07-19

## Decyzja

Run `a6a6600a-ee67-4361-ac0f-59aa809ce8c2` jest **odrzucony**. Nie wolno traktować go jako nowego baseline'u ani promować jego zmiany do produkcji.

Punktem odniesienia pozostaje run `2a9ffda1-180f-4102-a2ae-2724e2cf9a01`.

## Identyfikatory i artefakty

- datasetId: `b41739b4-b6e4-4c69-b0b8-f1ba7e02a399` (`test1`, 6 zamrożonych klipów)
- baseline runId: `2a9ffda1-180f-4102-a2ae-2724e2cf9a01`
- odrzucony runId: `a6a6600a-ee67-4361-ac0f-59aa809ce8c2`
- status odrzuconego runu: 6/6 klipów, 0 failures
- manifest: `%APPDATA%\com.openclipper.app\test-datasets\b41739b4-b6e4-4c69-b0b8-f1ba7e02a399\runs\a6a6600a-ee67-4361-ac0f-59aa809ce8c2\manifest.json`

Dataset, anotacje, progi scoringu i repozytoria `reference-algorithms/` nie zostały zmienione.

## Hipoteza eksperymentu

Oględziny miss-frame'ów wykazały czarne pasy w `super-bass`. `build-autoflip-track.ts` analizował aktywny obraz przez `contentRect`, ale na końcu `expandCropAcrossBars()` ponownie rozszerzał viewport przez wykryte pasy.

Eksperyment usunął to końcowe rozszerzenie i pozostawił crop wyliczony w aktywnym obrazie. Intencją było:

- nie zużywać powierzchni viewportu na martwe piksele;
- utrzymać docelowy aspect ratio;
- zmniejszyć pole cropa bez utraty istotnej treści.

## Co faktycznie się stało

Zmiana usunęła pasy, ale równocześnie zwęziła crop w osi poziomej. Dla źródła 1920×1080 i aktywnej wysokości około `0.75`:

- nominalna szerokość source-space dla 9:16 wynosi około `0.3164`;
- crop liczony względem aktywnego obrazu miał source-space width około `0.2373`;
- viewport stał się około 25% węższy i zaczął odcinać targety.

To naruszyło nadrzędną zasadę: najpierw zachować wymagane subjecty, dopiero potem minimalizować pole i usuwać pasy. Pasy były widocznym defektem, ale nie głównym ograniczeniem benchmarku.

## Wyniki: baseline → odrzucony run

Wartości są średnią z tych samych sześciu klipów.

| Format | coverageHitRate | meanCoverageFraction | p5CoverageFraction |
|---|---:|---:|---:|
| overall | **0.7974** → 0.6705 | **0.9189** → 0.8729 | **0.6723** → 0.6168 |
| 9:16 | **0.6749** → 0.5628 | **0.8518** → 0.8082 | **0.4933** → 0.4556 |
| 1:1 | **0.7994** → 0.6760 | **0.9291** → 0.8840 | **0.6520** → 0.5893 |
| 4:5 | **0.7203** → 0.6059 | **0.8961** → 0.8516 | **0.5577** → 0.5066 |
| 16:9 | **0.9949** → 0.8374 | **0.9984** → 0.9478 | **0.9863** → 0.9159 |

Dodatkowe regresje:

- mean coverage reacquisition: `1349.6 ms → 1978.1 ms`;
- mean p95 velocity: `0.0844 → 0.0938`;
- mean p95 acceleration: `8.27 → 20.39`;
- suma `processingMs`: `393539 ms → 597346 ms` (`1.52x`; wynik obciążony zmiennością środowiska, ale przekracza bramkę `1.25x`).

Contain duty cycle (`0.0768 → 0.0778`) i switches/min (`8.608 → 8.608`) praktycznie się nie zmieniły. Regresja wynika z geometrii cropa, nie z częstszego contain ani przełączania layoutu.

## Lokalizacja regresji

Cztery klipy były bit-identical w `coverageHitRate`. Regresja skupiła się w dwóch klipach z wykrytym niepełnym `contentRect`.

### `super-bass` (`03515d95-...`)

| Format | coverageHitRate | Delta |
|---|---:|---:|
| 9:16 | 0.757431 → 0.188247 | -56.92 pp |
| 1:1 | 0.845917 → 0.175606 | -67.03 pp |
| 4:5 | 0.805261 → 0.184831 | -62.04 pp |
| 16:9 | 1.000000 → 0.054663 | -94.53 pp |

### `export_2026-07-15_17-13-10_1080p` (`b02a7ed9-...`)

| Format | coverageHitRate | Delta |
|---|---:|---:|
| 9:16 | 0.652830 → 0.549057 | -10.38 pp |
| 1:1 | 0.929245 → 0.859434 | -6.98 pp |
| 4:5 | 0.825943 → 0.759906 | -6.60 pp |
| 16:9 | 1.000000 → 1.000000 | 0.00 pp |

## Dlaczego walidacja lokalna nie wystarczyła

Nowy test sprawdzał, czy crop:

- pozostaje wewnątrz `contentRect`;
- zachowuje matematyczny aspect ratio;
- nie obejmuje czarnych pasów.

Nie sprawdzał jednak najważniejszego warunku: zachowania dotychczasowego poziomego span-u i pokrycia targetu. Test potwierdził geometrię implementacji, ale nie potwierdził celu produktu.

Pełne `npm test` przeszło: 30 plików, 117 testów. `npm run tauri:build:fast` również przeszedł. To potwierdza, że problem był semantyczną regresją jakości, a nie błędem kompilacji lub kontraktu.

## Wnioski obowiązujące dla kolejnej próby

1. Nie zmieniać globalnie `contentRect`/bar policy w ramach optymalizacji coverage.
2. Jeżeli temat pasów wróci, viewport aktywnego obrazu musi zachować co najmniej dotychczasowy subject span. Niedopasowanie aspect ratio należy obsłużyć paddingiem renderera, nie zwężeniem cropa.
3. Każdy test geometrii musi zawierać target przy krawędzi i asercję coverage, nie tylko asercję wymiarów.
4. Zmianę dotyczącą `contentRect` najpierw uruchomić jako canary na `super-bass` i `b02a7ed9-...`; pełny dataset wolno uruchomić dopiero po braku regresji w każdej komórce.
5. Następny główny eksperyment ma dotyczyć wyboru właściwej hipotezy subjectu/grupy, zgodnie z `next_steps.MD`, a nie globalnego zmniejszania viewportu.
6. Przed pełnym dekodowaniem użyć offline replay i leave-one-clip-out. Gdy zmiana nie jest odtwarzalna z cache, wykonać najpierw jeden klip i jeden najbardziej ryzykowny aspect.

## Stan końcowy

- baseline pozostaje `2a9ffda1-180f-4102-a2ae-2724e2cf9a01`;
- run `a6a6600a-ee67-4361-ac0f-59aa809ce8c2` zachować wyłącznie jako negatywny artefakt diagnostyczny;
- zmianę algorytmu cofnąć;
- zachować `run3.MD` i zaktualizowany `next_steps.MD` jako wejście do kolejnej iteracji.
