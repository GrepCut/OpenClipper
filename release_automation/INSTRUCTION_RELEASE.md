# Open Clipper Release Instructions (Prod)

Follow the steps below to prepare, build, and publish a new Open Clipper version for automatic update testing.

## Step 1: Version Preparation (Prepare)

Synchronizes the `YY.M.BUILD` version across all manifest files (`package.json`, `tauri.conf.json`, `Cargo.toml`).

Run from the `open-clipper` folder:

```powershell
npm run release:prepare
```

Optionally, with a specific version:

```powershell
python release_automation\release_manager.py prepare --version 26.8.1
```

## Step 2: Build the Application (Build)

Build the installer package and update signatures.

Run:

```powershell
npm run tauri:build
```

Or the full prepare + build + verify flow:

```powershell
npm run release:desktop
```

This command generates the `.exe` and `.exe.sig` files in `src-tauri\target\release\bundle\nsis\`.

## Step 3: Verify the Build (Verify)

Ensure the built artifacts match the prepared version.

Run:

```powershell
npm run release:verify-build
```

## Step 4: Promote to Mirror (Promote)

Copies artifacts to the local `r2_mirror` folder and updates `latest.json`.

Run:

```powershell
npm run release:promote
```

## Step 5: Publish to Production (R2)

After completing the steps above, upload the contents of:

`open-clipper\release_automation\r2_mirror\`

to Cloudflare R2 under the `open-clipper/` prefix.

Files to upload:

1. `open-clipper/windows/x86_64/latest.json`
2. `open-clipper/windows/x86_64/releases/<version>/*` (installer and signature)

## Step 6: Activate in Admin Panel

In the GrepCut admin panel, go to the **Open Clipper Updates** tab and create/activate the release:

- **Product**: `open-clipper`
- **Platform URL**: from `latest.json` → `platforms.windows-x86_64.url`
- **Signature**: from `latest.json` → `platforms.windows-x86_64.signature`
- Set `isActive: true`

The backend API (`product=open-clipper`) controls update detection in the app.

---

## How to Test Autoupdate?

1. Install an **older** version on your computer.
2. Launch Open Clipper.
3. After activating the release in the backend, the app should detect the new version.
4. Click update and verify the process completes successfully.

For a clean test reinstall:

```powershell
npm run release:clean-install
```
