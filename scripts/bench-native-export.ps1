# Benchmark helper: native FFmpeg crop+encode (NVENC/QSV/AMF/x264) vs libx264 medium.
# Usage:
#   powershell -File scripts/bench-native-export.ps1 -InputPath .\sample.mp4 -DurationSec 30
#
# Mirrors the encoder preference order in src-tauri/src/video/ffmpeg/export.rs.

param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [int]$DurationSec = 30
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $InputPath)) { throw "Input not found: $InputPath" }

$ffmpeg = $env:OPEN_CLIPPER_FFMPEG
if (-not $ffmpeg) { $ffmpeg = $env:FFMPEG_PATH }
if (-not $ffmpeg -and (Test-Path "C:\ffmpeg\bin\ffmpeg.exe")) { $ffmpeg = "C:\ffmpeg\bin\ffmpeg.exe" }
if (-not $ffmpeg) { $ffmpeg = "ffmpeg.exe" }

$outDir = Join-Path $env:TEMP "open-clipper-export-bench"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$nativeOut = Join-Path $outDir "native.mp4"
$softOut = Join-Path $outDir "soft.mp4"

Write-Host "FFmpeg: $ffmpeg"
Write-Host "Input:  $InputPath (${DurationSec}s)"

function Test-Encoder([string]$Name, [string[]]$ExtraArgs) {
  $args = @(
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=0.04",
    "-frames:v", "1", "-c:v", $Name
  ) + $ExtraArgs + @("-f", "null", "-")
  & $ffmpeg @args 2>$null
  return ($LASTEXITCODE -eq 0)
}

$encoder = "libx264"
$encArgs = @("-preset", "veryfast", "-crf", "23")
$encodersOut = & $ffmpeg -hide_banner -encoders 2>&1 | Out-String

if ($encodersOut -match "h264_nvenc" -and (Test-Encoder "h264_nvenc" @("-preset", "p4", "-cq", "23"))) {
  $encoder = "h264_nvenc"
  $encArgs = @("-preset", "p4", "-rc", "vbr", "-cq", "23", "-b:v", "0")
} elseif ($encodersOut -match "h264_qsv" -and (Test-Encoder "h264_qsv" @("-global_quality", "23"))) {
  $encoder = "h264_qsv"
  $encArgs = @("-global_quality", "23")
} elseif ($encodersOut -match "h264_amf" -and (Test-Encoder "h264_amf" @("-rc", "cqp", "-qp_i", "23", "-qp_p", "23"))) {
  $encoder = "h264_amf"
  $encArgs = @("-rc", "cqp", "-qp_i", "23", "-qp_p", "23")
}

Write-Host "Encoder: $encoder"
$filter = "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=bicubic,setsar=1"

Write-Host ""
Write-Host "=== Native-style path ($encoder) ==="
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $ffmpeg -y -hide_banner -ss 0 -t $DurationSec -i $InputPath `
  -vf $filter `
  -c:v $encoder @encArgs -pix_fmt yuv420p `
  -c:a aac -b:a 192k -movflags +faststart `
  $nativeOut
$sw.Stop()
$nativeMs = $sw.ElapsedMilliseconds
Write-Host ("Native wall-clock: {0:N1}s" -f ($nativeMs / 1000.0))

Write-Host ""
Write-Host "=== Software baseline (libx264 medium) ==="
$sw.Restart()
& $ffmpeg -y -hide_banner -ss 0 -t $DurationSec -i $InputPath `
  -vf $filter `
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
  -c:a aac -b:a 192k -movflags +faststart `
  $softOut
$sw.Stop()
$softMs = $sw.ElapsedMilliseconds
Write-Host ("Soft wall-clock:   {0:N1}s" -f ($softMs / 1000.0))

if ($nativeMs -gt 0) {
  $speedup = $softMs / [double]$nativeMs
  Write-Host ""
  Write-Host ("Speedup vs libx264-medium: {0:N1}x" -f $speedup)
  Write-Host "WebView Canvas+WebCodecs is typically slower than libx264-medium;"
  Write-Host "so real app speedup vs current export is often higher than this ratio."
}

Write-Host ""
Write-Host "Outputs: $nativeOut"
Write-Host "         $softOut"
