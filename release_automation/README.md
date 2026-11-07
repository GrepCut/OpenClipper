# Release Automation

Local release mirror for Open Clipper desktop updater artifacts. This directory mirrors the layout that can later be uploaded to the `open-clipper-updates` Cloudflare R2 bucket at `https://updates.openclipper.grepcut.com`.

## Supported Flow

1. Prepare a desktop release version before build. This chooses the next `YY.M.BUILD` version and syncs all manifests:

   ```powershell
   npm run release:prepare
   ```

2. Build and verify the desktop artifacts:

   ```powershell
   npm run release:desktop
   ```

3. Promote the verified build into the local updater mirror:

   ```powershell
   npm run release:promote
   ```

4. Inspect local release state:

   ```powershell
   python release_automation\release_manager.py status
   ```

5. For a clean reinstall on Windows test machines, close the app and clear Open Clipper local state:

   ```powershell
   npm run release:clean-install -- -DryRun
   npm run release:clean-install
   ```

6. If promotion was wrong, roll back the last promoted release:

   ```powershell
   python release_automation\release_manager.py rollback
   ```

## Commands

- `prepare`: creates `prepared_release.json` and synchronizes all version manifests before build.
- `verify-build`: confirms manifest versions, installer names, and signatures match the prepared version.
- `verify-runtime`: checks values captured from `app.getVersion()` and `invoke("get_app_version")`.
- `promote`: copies the verified build into `r2_mirror` and updates `latest.json`.
- `rollback`: restores the previous active promoted version and re-syncs manifests locally.

## Output Layout

```text
release_automation/
  release_history.json
  r2_mirror/
    windows/x86_64/
      latest.json
      releases/
        26.8.1/
          Open Clipper_26.8.1_x64-setup.exe
          Open Clipper_26.8.1_x64-setup.exe.sig
          checksums.json
```

Upload the contents of `r2_mirror/` directly to the R2 bucket root (for example `windows/x86_64/latest.json`).

Default public base URL: `https://updates.openclipper.grepcut.com`

After upload, activate the release in the GrepCut admin panel under **Open Clipper Updates** with the platform URL and signature from `latest.json`.
## Sentry source maps

Packaged builds upload hidden source maps to `01starling/javascript-react-d0` when
`SENTRY_AUTH_TOKEN` is set in the release environment. The token must allow release
artifact uploads. It is used only by the build plugin, never included in the app.
The plugin uses the same `open-clipper@<package version>` release as the runtime,
and removes `.map` files from `dist` after a successful upload.

For a deliberate standalone frontend upload, set `OPEN_CLIPPER_SENTRY_UPLOAD=1`
and run `npm run build:tauri`. That flag requires `SENTRY_AUTH_TOKEN`; upload
failures fail the build. Use a fresh release version for changed bundles.
Normal local builds and `--no-bundle` previews do not enable uploads automatically.

Regression checks for media fixes:

```powershell
npm test
npx tsc --noEmit
npm run lint
node scripts/smoke-render.mjs
```

The last check uses an isolated headless Edge profile and FFmpeg from PATH to
exercise real WebCodecs: 96 kHz audio, changing crops, stitched segments,
captions/branding and cancellation. It does not open user projects.
From `src-tauri`, run `cargo test --lib`, then explicitly run the native recovery
smoke with `cargo test --lib repairs_mpeg4_and_96khz_audio -- --ignored --nocapture`.

The publication round trip and packet-memory regression can be run together with
`cargo test --lib video::ffmpeg::compatible_media::tests -- --ignored --nocapture --test-threads=1`.
The memory check processes a temporary 30-second raw-video fixture (about 300 MiB)
and limits private-memory growth after warm-up to 64 MiB. The publication check
repairs the range, replaces `clip-trimmed.mp4`, reopens it, and verifies a Studio
cut uses H.264 while the original source stays intact.

Frontend preparation and restore tests use Vitest directly:
`npx vitest run src/features/clipper/lib/media/media-preflight.util.test.ts src/features/clipper/pipeline/stages/trim.util.test.ts`.
