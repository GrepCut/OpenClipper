# Run 6 — rekalibracja arbitra przez offline replay (Kierunek 1)

**Run ID:** `dc20866a-b36d-4c37-b314-ba8da33f04b8`
**Run potwierdzający:** `91eae18f-fe20-4d7d-bfcd-243b94da8ad8`
**Status:** completed (18/18 klipów, 72 wyniki aspect, 0 błędów w obu runach)
**Dataset ID:** `cd986c2a-d998-4a96-afec-218d052d8c78`
**Dataset:** Maui Test
**Data:** 2026-07-18
**Analizator:** `autoflip-v14-hybrid-arbiter` (rekalibrowane progi arbitra)

## Co zostało zrobione

Zrealizowano kroki 1–3 rekomendowanej kolejności z `next_steps.MD`:

1. **Offline replay selektora** — nowe narzędzie `npm run replay:arbiter` odtwarza decyzje
   arbitra na danych zapisanych przez Run5 (autoflip-debug.json + baseline.jsonl +
   strategy-comparison.json + snapshot GT z manifestu), bez dekodowania wideo i bez WinML.
   Self-check: replay z parametrami Run5 odtwarza zapisany run **dokładnie**
   (identyczne strategie per próbka, metryki per klip ≤ 0,1 pp, agregat ≤ 0,05 pp).
2. **Refaktor arbitra** — logika decyzyjna wydzielona do czystego modułu
   `layout-arbiter.ts` z jawnymi parametrami (`ArbiterParams`); produkcja i replay
   używają tej samej funkcji `decideLayoutStrategy`. Kontekst decyzji z definicji
   nie zawiera ground truth ani tożsamości klipu.
3. **Kalibracja** — sweep 540+288 kombinacji progów + walidacja leave-one-clip-out
   (podział całymi klipami). Promowane parametry to zmiana wyłącznie:
   - `proposalMargin`: 0.15 → **0.075**
   - `stabilityKeyframes`: 4 → **5**
   - `dropoutToleranceSec`: 0.6 → **0.8**

Interpretacja: niższy próg przewagi propozycji semantic pozwala częściej korzystać
z lepszej geometrii kandydata, a dłuższe wymaganie stabilności tożsamości (5 klatek
kluczowych, tolerancja zaniku 0,8 s) kompensuje ryzyko wyboru niewłaściwego podmiotu.
Progi confidence/importance okazały się nieaktywne w zwycięskim regionie (remisy),
więc zostały przy wartościach Run5 (reguła parsimony).

## Przewidywanie replay (przed benchmarkiem)

| Metryka 9:16 | Run5 | Replay Run6 (przewidywane) | Zmiana |
|---|---:|---:|---:|
| Focus hit | 66,35% | **69,25%** | **+2,90 pp** |
| Widoczność celu | 90,88% | **90,90%** | +0,02 pp |
| Dwa cele widoczne | 35,01% | **35,01%** | 0,00 pp |

Największy zysk per klip: „World's LARGEST Cash Prize Reality Show" **+46,02 pp focus**
(stabilny cel, którego Run5 nie wybierał przez zbyt wysoki margin).
Najgorsza delta: „Full Interview MrBeast" (jeden z klipów) −2,01 pp visibility —
daleko od progu katastrofy (−10 pp na obu metrykach naraz).

## Wynik benchmarku

| Metryka 9:16 | Run4 | Run5 | Przewidywane (replay) | Run6a | Run6b |
|---|---:|---:|---:|---:|---:|
| Focus hit | 65,47% | 66,35% | 69,25% | **69,25%** | **69,25%** |
| Widoczność celu | 89,55% | 90,88% | 90,90% | **90,91%** | **90,91%** |
| Dwa cele widoczne | 35,01% | 35,01% | 35,01% | **35,01%** | **35,01%** |

Focus hit 9:16 wzrósł o **+2,90 pp względem Run5** (+4,44% względnie) i **+3,78 pp
względem Run4**, bez spadku visibility i dual visibility.

### Wynik ogólny wszystkich 72 kombinacji clip × aspect

| Metryka | Run5 | Run6 | Zmiana |
|---|---:|---:|---:|
| Średni focusHitRate | 67,60% | **69,31%** | **+1,71 pp** |
| Średnia widoczność celu | 92,45% | **92,52%** | **+0,07 pp** |

### Kryteria

| Kryterium | Wynik |
|---|---|
| Focus ≥ Run5 (66,35%) | **PASS** (69,25%) |
| Visibility ≥ Run5 (90,88%) | **PASS** (90,91%) |
| Dual visibility ≥ Run5 (35,01%) | **PASS** (35,01%) |
| Wszystkie metryki ≥ Run4 floor | **PASS** |
| Brak klipu ze spadkiem focus i visibility > 10 pp naraz | **PASS** (najgorzej: −0,67 pp focus, −2,01 pp visibility, różne klipy) |
| Dwa runy ≤ 0,5 pp różnicy | **PASS** (różnica 0,00 pp — wynik identyczny co do 10 miejsca) |
| Zgodność replay ↔ benchmark ≤ 0,2 pp | **PASS** (≤ 0,01 pp — replay ma pełną wierność) |

Bramka czasu (12 350 ms/klip) nie przeszła na tej maszynie (14,7 s i 17,8 s/klip),
podobnie jak w części runów Run5 — czas zależy od warunków wykonania i nie wpływa
na metryki jakości. Ambitne cele 70,5% focus / 92% visibility / 40% dual pozostają
otwarte; focus zbliżył się do nich o połowę dystansu z Run5.

Największe zmiany per klip (9:16, Run6 vs Run5): `dc879779` **+46,02 pp focus**,
`1b1fd5a2` +4,96 pp focus / +1,05 pp visibility, `8589b3d2` +1,14 pp / +1,09 pp;
najgorzej `410b7f30` −2,01 pp visibility przy niezmienionym focus.

## Walidacja leave-one-clip-out

- Zysk focus generalizuje: średnia held-out focus 69,45% vs 66,35% zapisane.
- Wybór parametrów między foldami wahał się między margin 0.06 (17/18 foldów,
  bez zapasu na visibility) a 0.075; wybrano 0.075 jako jedyny wariant
  z visibility ≥ floor Run5 na pełnym datasecie.
- Plateau: sąsiedzi siatki (margin 0.09, stabilność 6, dropout 0.6/1.0) również
  przechodzą bramki; jedynie stabilność 4 zahacza o próg visibility (−0,02 pp).

## Split i contain — pozostają shadow

Replay aktywacji split na skalibrowanych parametrach: dual **spada** 35,01% → 33,46%,
visibility 90,90% → 90,28% — semantyczny split jest wciąż gorszy od legacy collage.
Aktywacja contain: visibility spada do 90,83%. Oba pozostają shadow candidates,
zgodnie z bramkami z `next_steps.MD` (Kierunek 6 niespełniony).

## Zmiany w kodzie

- `src/features/clipper/engine/autoflip/layout-arbiter.ts` (nowy) — `ArbiterParams`,
  `DEFAULT_ARBITER_PARAMS` (jedyna zmiana produkcyjnego zachowania), `decideLayoutStrategy`,
  `stableRequiredIds`, `isReliablePrimary`, `subjectLifetimeSec` + opcjonalne strażniki
  (coverage/lifetime/competitor/motion-margin — wyłączone, dostępne dla przyszłych iteracji).
- `layout-planner.ts` — używa `decideLayoutStrategy`; zapisuje `baselineViewports`
  na każdej próbce (zamyka lukę fidelity replayu od Run6).
- `build-autoflip-track.ts` — przekazuje `sceneMotion` (motionType per scena) do arbitra.
- `src/features/tests/benchmark/replay/` — `replay-io.ts`, `replay-engine.ts`,
  `replay-sweep.ts` + CLI `scripts/replay-arbiter.ts` (`--mode self-check|single|sweep|loco`).
- Siatki kalibracyjne w `scripts/replay-grids/`; raporty w git-ignorowanym `benchmark-replays/`.

## Ścieżki wyników

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\dc20866a-b36d-4c37-b314-ba8da33f04b8\manifest.json
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\91eae18f-fe20-4d7d-bfcd-243b94da8ad8\manifest.json
```

Od Run6 każda próbka layoutu zapisuje dodatkowo `baselineViewports`, więc przyszłe
replaye nie potrzebują już aproksymacji baseline na próbkach semantic.

## Jak powtórzyć

```
npm run replay:arbiter -- --mode self-check          # fidelity vs Run5
npm run replay:arbiter -- --mode single              # predykcja z obecnymi domyślnymi
npm run replay:arbiter -- --mode sweep --grid scripts/replay-grids/run6-coarse.json
npm run replay:arbiter -- --mode loco  --grid scripts/replay-grids/run6-loco.json
```
