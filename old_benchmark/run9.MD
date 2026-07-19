# Iteracja 9 — wynik replay i decyzja promocji

Data: 2026-07-18

## Status

**ODRZUCONE — Run 8 pozostaje produkcyjnym fallbackiem.**

Kontroler Run 9 został zaimplementowany i sprawdzony offline na pełnych
artefaktach Run 8 (`9062956a-ee2a-4aaa-a574-1bc07047fd56`, 18/18 klipów).
Kandydat nie przeszedł bramek jakości, dlatego zgodnie z planem nie został
promowany i nie uruchomiono kosztownego pełnego benchmarku ani runu
potwierdzającego.

Pełny raport maszynowy: `benchmark-replays/run9-replay-v3.json`.

## Wynik wybranego kontrolera

| Metryka 9:16 | Run 8 | Run 9 replay | Bramka / cel |
|---|---:|---:|---:|
| visibility | 91,89% | 92,75% | cel ≥ 95% |
| dual visibility | 51,21% | 49,78% | floor 51,21%; cel ≥ 90% |
| contain duty cycle | — | 4,76% | ≤ 5% |
| przełączenia layoutu | — | 20,69/min | ≤ 6/min |
| focus (diagnostycznie) | 67,97% | 65,30% | bez wpływu na objective |

Kandydat zwiększa średnią visibility o 0,86 pp i mieści się w limicie contain,
ale traci dual visibility i zbyt często zmienia tryb. Nie spełnia minimum
promocji.

## Kontrfaktyczne warianty

Wartości są średnią per clip. Wariant jest używany tylko w próbkach, w których
da się go zbudować z rzeczywistych detekcji; w pozostałych próbkach zachowuje
Run 8.

| Wariant | Visibility | Dual visibility |
|---|---:|---:|
| Run 8 baseline | 92,10% | 51,24% |
| shifted crop | 92,03% | 51,38% |
| wider crop | 90,71% | 49,17% |
| stable split v2 | 91,71% | 46,09% |
| contain fail-safe | 97,45% | 78,79% |

Contain potwierdza geometryczną możliwość przekroczenia 95%, ale nie może być
promowany: jego użycie jako stałego rozwiązania łamałoby limit duty cycle i
obniżało jakość obrazu. Stable split v2 oparty na bieżących detekcjach nie ma
jeszcze wystarczającego recall/tożsamości, aby zbliżyć dual visibility do 90%.

## Miss ledger wybranego kontrolera

| Przyczyna | Missy |
|---|---:|
| brak detekcji | 770 |
| zły layout | 1569 |
| zbyt późna reakcja kamery | 313 |
| zła tożsamość rozpoznana w contain | 0 |

Klasyfikacja nie używa GT w runtime. GT jest stosowane dopiero podczas replay
do oceny finalnych viewportów.

## Najgorsze klipy

| Klip | Visibility Run 9 |
|---|---:|
| World's LARGEST Cash Prize Reality Show Revealed | 76,58% |
| betty | 83,46% |
| super-bass | 87,99% |
| Spring_-_Blender_Open_Movie.webm.1080p.vp9 | 88,33% |
| Full Interview MrBeast | 88,60% |

## Najczęstsze reason codes

| Reason code | Liczba próbek |
|---|---:|
| insufficient-proposal-margin | 21698 |
| unstable-target | 18904 |
| insufficient-semantic-evidence | 8204 |
| lookahead-envelope | 4828 |
| stable-semantic-target | 4828 |
| visibility-coverage-gain | 3766 |
| visibility-shift | 2425 |
| contain-visibility-fail-safe | 1183 |
| predicted-visibility-risk | 1055 |
| stable-split-v2 | 642 |

## Wdrożone elementy

- visibility envelope z marginesem prędkości i lookahead 0,8 s bez przejścia
  przez scene cut;
- twarde porównanie coverage każdego required region z Run 8 przed scoringiem;
- drabina Run 8 → shift → wider → stable split v2 → contain fail-safe;
- stabilna kolejność paneli resetowana na scene cut;
- blokada tworzenia panelu/primary z predicted-only;
- blokada recovery-only targetu bez powiązanej face/head/pose evidence;
- counterfactual variants i reason codes per sample;
- miss ledger, contain duty, przełączenia layoutu, p95 ruchu kamery oraz proxy
  czytelnego rozmiaru osoby;
- visibility-first sweep/LOCO objective, bez focus jako floor lub tie-breakera;
- produkcyjny Run 8 pozostawiony bez zmian po nieudanej bramce promocji.

## Kryterium zatrzymania i kolejny krok

Stable split v2 z rzeczywistych detekcji obniża dual visibility do 46,09%, a
contain-based kontrfaktyczny wariant dochodzi tylko do 78,79% dual. Dalsze
strojenie samej geometrii nie jest uzasadnione. Następna iteracja powinna
domknąć runtime LR-ASD (decode A/V 25 FPS, MFCC i okna 2 s/50%) oraz poprawić
recall i powiązanie tożsamości face↔person. Dopiero potem należy ponowić replay
i LOCO; pełny benchmark pozostaje zablokowany do przejścia bramek.
