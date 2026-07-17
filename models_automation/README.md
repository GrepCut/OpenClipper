# Models Automation

Niezależny, zweryfikowany zestaw modeli Open Clipper do ręcznej publikacji w
Cloudflare R2 pod `https://models.openclipper.grepcut.com/v1`.

Automatyzacja publikuje wyłącznie modele pobierane na żądanie przez web i Tauri:
AutoFlip, BlazeFace, runtime Magic Touch oraz produkcyjne pliki Parakeet.
Testowe WAV-y, README i natywne `src-tauri/resources/models/clipper-vision`
nie wchodzą do CDN.

```powershell
npm run models:prepare
npm run models:verify
npm run models:promote
```

Wyślij zawartość `models_automation/r2_mirror/` do bucketa, zachowując prefiks
`v1/`. Najpierw opublikuj pliki `v1/models/...`, a dopiero potem
`v1/model-manifest.json`; po każdej zmianie unieważnij cache manifestu.

Lokalny development zawsze używa `public/models`. Produkcyjny web pobiera
modele bezpośrednio z CDN, a produkcyjny Tauri korzysta z lokalnego,
zweryfikowanego cache.
