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
