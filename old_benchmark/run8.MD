# Run 8 — visibility-first

Data: 2026-07-18

## Decyzja jakościowa

Na polecenie właściciela projektu metryką decyzyjną jest visibility. Focus
opisuje wycentrowanie targetu i pozostaje wyłącznie diagnostyką. Kandydat może
zostać promowany, jeżeli target pozostaje widoczny, nawet gdy nie jest
wycentrowany.

Floor Run 6 (`dc20866a-b36d-4c37-b314-ba8da33f04b8`): visibility 90,91%, dual
visibility 35,01%. Focus 69,25% jest raportowany, ale nie blokuje promocji.

## 8A — SSD primary + YOLOX recovery-only

Wdrożono selektywne uruchamianie YOLOX po utracie lub osłabieniu SSD, provenance
`detectorSource`, reset na scene cut, deduplikację zachowującą SSD, kontrolę
dowodów pose/face/persistence oraz telemetrię per klip. YOLOX nie zastępuje
stabilnego, obserwowanego tracku SSD.

| Przebieg | Run ID | Visibility | Dual visibility | Focus (diagn.) | Śr. czas | Mediana | P95 |
|---|---|---:|---:|---:|---:|---:|---:|
| v3 | `44844541-3232-491c-bdbc-21e738e171b0` | 91,86% | 51,21% | 67,89% | 15 433 ms | 16 446 ms | 20 991 ms |
| potwierdzenie | `9062956a-ee2a-4aaa-a574-1bc07047fd56` | 91,89% | 51,21% | 67,97% | 14 481 ms | 15 289 ms | 20 310 ms |

Różnica między pełnymi przebiegami: visibility 0,034 pp, dual visibility 0,000
pp. Oba przebiegi ukończyły 18/18 klipów, bez błędów i bez katastroficznej
regresji visibility. Względem Run 6 potwierdzenie daje +0,98 pp visibility i
+16,21 pp dual visibility. Kandydat został promowany jako ustawienie domyślne
`yolox-recovery`, z SSD nadal jako detektorem głównym.

Telemetria przebiegu potwierdzającego: 4251 triggerów i wywołań YOLOX, 4604
zaakceptowane obserwacje recovery, 1577 odrzuconych duplikatów, 711 odrzuconych
kandydatów oraz 71 015 ms łącznej inferencji YOLOX. Powody akceptacji: pose 343,
face 1728, temporal persistence 2533, predicted IoU 0.

## 8B — LR-ASD

Dodano deterministyczny eksporter LR-ASD AVA do ONNX, wpis w manifeście modeli,
probe WinML, nazwane wejścia audio/face oraz politykę wyboru aktywnego mówcy z
minimalnym okresem wielotwarzowym 1 s, hold 0,8 s i resetem na scene cut/luki.

Model `lr_asd_ava.onnx` ma SHA-256
`8dba7d770fafdd60ae0d7ce521bc83cf2e8852f3ce30878aee6a134efd53cfbb`.
Parzystość PyTorch–ONNX dla dynamicznych okien 1–6 s osiągnęła maksymalny błąd
bezwzględny `1,1641532182693481e-09`.

Pełny drugi decode 25 FPS z runtime MFCC nie został w tej iteracji podłączony do
produkcyjnego przetwarzania. LR-ASD pozostaje przygotowanym kandydatem shadow;
brak audio, jedna twarz lub błąd nadal zachowują fallback.

## 8C — visibility-constrained reframing

Dodano pełny visibility guard z marginesem 8%, stabilizację primary przez pięć
keyframe'ów, łagodne skale 1,00/0,95/0,90/0,80, hysteresis, ograniczenie ruchu
kamery i natychmiastowy fallback Run 6 dla wielu targetów, prediction-only oraz
scene cut.

Self-check replay Run 6 przeszedł. Sweep 24 kombinacji dał najlepszy wynik:
focus 67,48%, visibility 90,69%, dual visibility 35,01%. Ponieważ visibility
spadło poniżej floor 90,91%, 8C pozostaje shadow. Raport:
`benchmark-replays/run8-visibility-sweep.json`.

## Walidacja

- replay self-check Run 6: PASS;
- testy TypeScript/Vitest: 98/98 PASS;
- testy recovery pipeline Rust: 7 PASS, 1 test środowiskowy ignored;
- build web/Tauri i `cargo check`: PASS podczas implementacji; końcowa walidacja
  po promocji jest wykonywana osobno.
