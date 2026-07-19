# Run 5 — hybrydowy baseline Run4 + bezpieczny semantic-single

**Run ID:** `87a76f18-e997-48cf-af13-48cf539ab8a4`  
**Run potwierdzający:** `a60f4716-cb84-46c1-b34a-89482fb7c5c6`  
**Dataset ID:** `cd986c2a-d998-4a96-afec-218d052d8c78`  
**Dataset:** Maui Test  
**Status:** completed (18/18 klipów, 72 wyniki aspect, 0 błędów)  
**Data:** 2026-07-18  
**Analizator:** `autoflip-v14-hybrid-arbiter`

## Najważniejszy wynik: 9:16 względem Run4

To jest porównanie dokładnie tego outputu, na którym zależy produktowo: wejście około 16:9 i pionowy output 9:16.

| Metryka 9:16 | Run4 | Run5 | Zmiana w pp | Zmiana względna |
|---|---:|---:|---:|---:|
| Focus hit | 65,47% | **66,35%** | **+0,88 pp** | **+1,35%** |
| Widoczność celu | 89,55% | **90,88%** | **+1,33 pp** | **+1,49%** |
| Dwa cele widoczne jednocześnie | 35,01% | **35,01%** | 0,00 pp | 0,00% |

Wynik jest zatem **lepszy od Run4 w focus i visibility oraz nie ma regresji dual visibility**.

## Wynik względem poprzedniej, nieudanej nowej architektury

Poprzedni najnowszy run (`207986a1-fc60-4878-a25a-2f1c58867b2d`) osiągał dla 9:16:

| Metryka 9:16 | Poprzedni run | Run5 | Zmiana |
|---|---:|---:|---:|
| Focus hit | 51,39% | **66,35%** | **+14,96 pp** |
| Widoczność celu | 63,53% | **90,88%** | **+27,35 pp** |
| Dwa cele widoczne jednocześnie | 23,33% | **35,01%** | **+11,67 pp** |

Regres względem Run4 został więc usunięty.

## Wynik ogólny wszystkich 72 kombinacji clip × aspect

| Metryka | Run4 | Run5 | Zmiana |
|---|---:|---:|---:|
| Średni focusHitRate | 67,30% | **67,60%** | **+0,30 pp** |
| Średnia widoczność celu | 92,07% | **92,45%** | **+0,38 pp** |

## Powtarzalność

Dwa pełne runy tej samej wersji selektora dały identyczne metryki jakości 9:16:

- `a60f4716-cb84-46c1-b34a-89482fb7c5c6`
- `87a76f18-e997-48cf-af13-48cf539ab8a4`

Różnica pomiędzy nimi wynosi **0,00 pp** dla focus, visibility i dual visibility.

## Co poprawiło wynik

- Odtworzono Run4 jako niezależny, bezpieczny baseline.
- Motion saliency nie może już samodzielnie zostać primary targetem.
- Dodano kompensację globalnego ruchu kamery przed wyznaczaniem lokalnego ruchu.
- Tożsamość ważnego podmiotu jest utrzymywana przez krótkie zaniki detektora.
- Semantic crop jest wybierany tylko dla stabilnego, potwierdzonego pojedynczego celu i tylko przy przewadze nad baseline.
- Eksperymentalne split i contain są nadal liczone i zapisywane jako shadow candidates, ale nie zastępują sprawdzonego layoutu Run4.
- W finalnym runie `semantic-single` został użyty na 802 klatkach, a `legacy-baseline` na 31 196 klatkach 9:16.

Sam semantic candidate osiągnął focus około **69,36%**, ale visibility tylko około **83,87%**. Potwierdza to, że geometria ma dalszy potencjał, lecz selektor nadal musi ostrożnie odróżniać prawdziwy ważny podmiot od fałszywego celu.

## Wydajność

Średni czas analizy w runie potwierdzającym wyniósł około **12 824 ms na klip**. To około 3,8% ponad techniczny limit 12 350 ms, ale nie wpływa na powyższe metryki jakości. W runie wcześniejszym ta sama jakość została osiągnięta przy 15 128 ms, więc czas zależy również od warunków wykonania.

## Kryteria

| Kryterium jakościowe Run4 floor | Wynik |
|---|---|
| Focus ≥ Run4 | **PASS** |
| Visibility ≥ Run4 | **PASS** |
| Dual visibility ≥ Run4 | **PASS** |
| Brak katastrofalnej regresji pojedynczego klipu | **PASS** |

Ambitne cele 70,5% focus, 92% visibility i 40% dual visibility nie zostały jeszcze osiągnięte. Run5 jest jednak bezpiecznym krokiem naprzód: usuwa regres nowej architektury i daje mierzalny, powtarzalny wynik lepszy niż Run4.

## Ścieżki wyników

```
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\87a76f18-e997-48cf-af13-48cf539ab8a4\manifest.json
C:\Users\Adam\AppData\Roaming\com.openclipper.app\test-datasets\cd986c2a-d998-4a96-afec-218d052d8c78\runs\87a76f18-e997-48cf-af13-48cf539ab8a4\clips\
```

Dla każdego klipu i aspektu zapisano dodatkowo:

- `*-strategy-comparison.json` — selected vs baseline vs semantic candidate,
- `*-baseline.jsonl` — wynik per klatka dla baseline,
- `*-semantic-candidate.jsonl` — wynik per klatka dla kandydata semantic,
- `autoflip-debug.json` — importance timeline, layout decisions i reason codes.
