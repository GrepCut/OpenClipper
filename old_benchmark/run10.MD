# Run 10 — canonical identity i stable visibility

Data: 2026-07-18

## Decyzja

**PROMOWANE na polecenie właściciela projektu.** Run 10 jest produkcyjnym
ustawieniem domyślnym mimo niezaliczenia formalnych bramek z `next_steps.MD`.
Decyzję oparto na świeżym natywnym benchmarku 18/18, w którym najważniejsza
metryka visibility wzrosła względem strategii produkcyjnej Run 8 o 0,24 pp.

Produkcja wywołuje `buildAutoFlipTrack` z `iteration10: true`, benchmark ocenia
Run 10 jako `selected`, a wersja cache została podniesiona z
`autoflip-v16-canonical-shadow` do `autoflip-v16-canonical`.

## Zaimplementowane

- benchmark-only attribution z rozłącznymi kategoriami `no-evidence`,
  `identity-mismatch`, `layout-uncovered`, `late-transition` i
  `interpolation-loss`;
- detection/identity/layout/timing/interpolation oracle, reason-transition table
  oraz breakdown single/dual, scene, layout i detector source;
- schemat debug v3 zapisujący surowe subject samples wyłącznie w artefaktach
  benchmarku; GT nie jest importowane przez runtime ani arbiter;
- `CanonicalPersonTrack` z globalnym dopasowaniem face/person/pose, resetem na
  scene cut, dropoutem 0,6 s, velocity, ambiguity i telemetrią
  births/deaths/switches/reacquisition;
- recovery YOLOX tylko jako uzupełnienie istniejącej tożsamości; temporal
  persistence wymaga dwóch poprzednich i bieżącego sample, czyli trzech
  kolejnych obserwacji;
- ASD policy z progami 0,60 / 0,10, stabilnością wielu osób, hold 0,8 s,
  mapowaniem wyłącznie do istniejącego canonical face tracku, pełnym fail-open
  dla błędnego kontraktu i telemetrią;
- stable split v3: canonical panel order, 0,6 s pending, 1,5 s minimum active,
  1,2 s merge hysteresis, identity hold 0,6 s i zakaz splitu dla trzech podobnie
  ważnych osób;
- state machine `common`, `split-pending`, `split-active`, `merge-pending`,
  `contain-failsafe`, switch budget i contain dwell;
- kontrola coverage klatek pośrednich; niebezpieczna interpolacja przechodzi w
  hold/step;
- osobny `iteration10Candidate` w benchmarku oraz, po decyzji właściciela,
  ten sam wariant jako produkcyjne `selected`.

Runtime LR-ASD ma zweryfikowany model i kontrakt WinML oraz bezpieczną politykę
konsumpcji wyników. Drugi decode A/V nie został aktywowany po E1: zgodnie z
kryterium zatrzymania przy detection oracle poniżej 95% priorytetem pozostaje
recall, a brak score oznacza bit-for-bit Run 8 i reason
`insufficient-stable-canonical-persons`.

## Natywny benchmark i promocja

Build wykonano od zera poleceniem `npm run tauri:build:fast`. Zweryfikowana
binarka release:

- ścieżka: `src-tauri/target/release/open-clipper.exe`;
- rozmiar: 57 101 824 B;
- timestamp: 2026-07-18 21:38:00 CEST;
- smoke test `--help`: exit code 0.

Pełny benchmark uruchomiono realnym pipeline CLI na datasecie
`cd986c2a-d998-4a96-afec-218d052d8c78`.

- Run ID: `13941849-1bec-4fae-b2d9-4321d90c3f62`;
- wynik: 18/18 klipów, 0 błędów;
- manifest zapisany: 2026-07-18 21:44:20 CEST;
- średni czas przetwarzania: 17 121 ms/klip.

| Metryka 9:16 | Run 8 selected w tym samym przebiegu | Run 10 | Różnica / bramka |
|---|---:|---:|---:|
| visibility, średnia per clip | 94,19% | **94,43%** | **+0,24 pp**, bramka ≥95% niezaliczona |
| visibility, ważona obserwacjami | — | 93,54% | diagnostyczna |
| dual visibility | 67,21% | 67,04% | -0,17 pp, cel ≥90% niezaliczony |
| focus, diagnostyczny | 68,93% | 66,31% | -2,62 pp |
| worst-clip visibility | 76,58% | 76,58% | bez zmiany |
| contain duty, ważone klatkami | 0,00% | 5,39% | limit ≤5% niezaliczony |
| layout switches/min, średnia per clip | 3,75 | 18,09 | limit ≤6 niezaliczony |

Run 10 poprawił visibility na 4 klipach, zachował wynik na 11 i pogorszył na 3.
Żaden klip nie stracił więcej niż 10 pp. Względem odrzuconego replayu Run 9
(92,75%) wynik Run 10 jest liczbowo wyższy o 1,68 pp, ale nie jest to porównanie
1:1: Run 9 był replayem starszych artefaktów, a Run 10 pełnym natywnym runem z
aktualnym recovery i debug schema v3.

Formalna polityka przewidywała pozostawienie takiego wariantu w shadow. Na
jednoznaczne polecenie właściciela projektu Run 10 został jednak promowany;
nie uruchamiano drugiego runu potwierdzającego, ponieważ pierwszy run nie
przeszedł bramek jakościowych.

Po przełączeniu produkcyjnego defaultu wykonano ponowny fast build. Finalna
binarka promowana ma timestamp 2026-07-18 21:51:23 CEST, rozmiar 57 101 824 B,
a testy zakończyły się wynikiem 113/113 PASS.

## E0 — self-check

Źródło: Run 8 `9062956a-ee2a-4aaa-a574-1bc07047fd56`, 18/18 klipów.

- wynik: PASS;
- tolerancja: replay odtworzył zapisany run;
- artefakt: `benchmark-replays/run10-e0-self-check.json` (lokalny, ignorowany
  przez git).

## Historyczny E1/E5 — replay diagnostyczny na starym schemacie

Artefakt: `benchmark-replays/run10-e1-e5.json` (lokalny, ignorowany przez git).

| Metryka | Run 8 | Iteration 10 shadow | Bramka |
|---|---:|---:|---:|
| visibility (średnia per clip) | 91,89% | 93,09% | ≥95% |
| dual visibility | 51,21% | 51,70% | ≥90% cel |
| contain duty | — | 7,31% | ≤5% |
| layout switches/min | — | 21,62 | ≤6 |

Replay nie przechodził nowych bramek jakościowych. Najgorszy klip pozostawał
na 76,58%; późniejsza promocja została wykonana decyzją właściciela po natywnym
benchmarku opisanym wyżej.

### Oracle ceilings

Stary debug schema v2 nie przechowuje raw subject samples. Wyniki niżej używają
jawnie oznaczonego `ranked-importance-fallback`; nie wolno traktować ich jako
końcowego pomiaru detector-aware ceiling.

| Oracle | Visibility | Dual |
|---|---:|---:|
| detection | 27,01% | 6,38% |
| identity | 26,51% | 6,31% |
| layout | 26,51% | 6,31% |
| timing | 26,50% | 6,31% |
| interpolation | 25,96% | 5,56% |

Miss ledger dla 2528 rzeczywistych missów:

| Kategoria | Liczba |
|---|---:|
| no-evidence | 2269 |
| identity-mismatch | 7 |
| layout-uncovered | 4 |
| late-transition | 187 |
| interpolation-loss | 61 |

Dominacja `no-evidence` uruchamia kryterium zatrzymania 1. Nie wykonano LOCO,
sweepu contain ani release benchmarku, ponieważ strojenie layoutu na tych
danych łamałoby kolejność z `next_steps.MD`.

## Weryfikacja

- `npm test`: 30 plików, 113 testów — PASS;
- testy canonical/oracle/state machine: 17/17 — PASS;
- `npm run build:web` — PASS;
- `cargo check` — PASS;
- `cargo test recovery --lib`: 4/4 — PASS;
- `git diff --check` — PASS.

## Stan po promocji

Run 10 jest produkcyjnym defaultem. Run 8 pozostaje lokalnym fallbackiem dla
niezaufanych decyzji per sample. Najważniejsze ryzyka do kolejnej iteracji to
zbyt częste przełączenia layoutu, contain duty powyżej limitu, brak poprawy
worst-clip oraz niewielki spadek dual visibility. LR-ASD decode nadal nie jest
aktywny; polityka ASD działa fail-open przy braku poprawnego score.
