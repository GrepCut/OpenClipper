# Builds sherpa-onnx v1.13.4 with DirectML for linking via SHERPA_ONNX_LIB_DIR.
# Requires: Visual Studio 2022, Windows 10 SDK, CMake, Git.
$ErrorActionPreference = "Stop"

$Version = "1.13.4"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$OutputRoot = Join-Path $RepoRoot "third_party\sherpa-onnx-directml"
$SourceDir = Join-Path $OutputRoot "sherpa-onnx"
$BuildDir = Join-Path $OutputRoot "build"
$InstallDir = Join-Path $OutputRoot "install"
$PatchFile = Join-Path $RepoRoot "scripts\models\patches\sherpa-onnx-directml-adapter.patch"

function Ensure-SherpaSource {
    if (-not (Test-Path $SourceDir)) {
        git clone --depth 1 --branch "v$Version" https://github.com/k2-fsa/sherpa-onnx.git $SourceDir
        return
    }
    Push-Location $SourceDir
    try {
        git fetch --depth 1 origin "refs/tags/v$Version"
        # Undo only our local patch before switching tags. Other local edits
        # still make checkout fail instead of being overwritten.
        if (Select-String -Path "sherpa-onnx\csrc\session.cc" -Pattern "OPEN_CLIPPER_DIRECTML_DEVICE_ID" -Quiet) {
            git apply --reverse $PatchFile
        }
        git checkout "v$Version"
    } finally {
        Pop-Location
    }
}

function Apply-OpenClipperDirectMlPatch {
    if (-not (Test-Path $PatchFile)) {
        throw "Missing DirectML adapter patch: $PatchFile"
    }
    Push-Location $SourceDir
    try {
        if (-not (Select-String -Path "sherpa-onnx\csrc\session.cc" -Pattern "OPEN_CLIPPER_DIRECTML_DEVICE_ID" -Quiet)) {
            git apply $PatchFile
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Building sherpa-onnx v$Version with DirectML..."
Write-Host "Output: $InstallDir"

Ensure-SherpaSource
Apply-OpenClipperDirectMlPatch
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

Push-Location $BuildDir
try {
    cmake -A x64 `
        -DSHERPA_ONNX_ENABLE_DIRECTML=ON `
        -DBUILD_SHARED_LIBS=ON `
        -DSHERPA_ONNX_USE_STATIC_CRT=ON `
        -DCMAKE_BUILD_TYPE=Release `
        -DSHERPA_ONNX_ENABLE_TTS=OFF `
        -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF `
        -DCMAKE_INSTALL_PREFIX="$InstallDir" `
        $SourceDir

    cmake --build . --config Release
    cmake --install . --config Release
} finally {
    Pop-Location
}

$LibDir = Join-Path $InstallDir "lib"
if (-not (Test-Path (Join-Path $LibDir "sherpa-onnx-c-api.lib"))) {
    throw "Build finished but sherpa-onnx-c-api.lib not found in $LibDir"
}

$CargoConfig = Join-Path $RepoRoot "src-tauri\.cargo\config.toml"
$LibDirEntry = 'SHERPA_ONNX_LIB_DIR = { value = "../third_party/sherpa-onnx-directml/install/lib", relative = true }'
$ConfigText = Get-Content $CargoConfig -Raw
if ($ConfigText -notmatch 'SHERPA_ONNX_LIB_DIR') {
    $ConfigText = $ConfigText.TrimEnd() + "`n# Added by npm run sherpa:directml`n$LibDirEntry`n"
    Set-Content -Path $CargoConfig -Value $ConfigText -NoNewline
    Write-Host "Updated $CargoConfig with SHERPA_ONNX_LIB_DIR"
}

Write-Host ""
Write-Host "Done. DirectML libs installed to:"
Write-Host "  $LibDir"
Write-Host ""
Write-Host "Rebuild the app: cargo clean (in src-tauri) then npm run tauri:dev"
