#!/usr/bin/env bash
# Benchmark helper for native FFmpeg crop+encode vs a naive software baseline.
# Usage:
#   ./scripts/bench-native-export.sh /path/to/input.mp4 [duration_sec]
#
# Requires system ffmpeg with h264_nvenc (or falls back to libx264).

set -euo pipefail

INPUT="${1:?usage: bench-native-export.sh <input.mp4> [duration_sec]}"
DURATION="${2:-30}"
OUT_DIR="${TMPDIR:-/tmp}/open-clipper-export-bench"
mkdir -p "$OUT_DIR"

FFMPEG="${OPEN_CLIPPER_FFMPEG:-${FFMPEG_PATH:-ffmpeg}}"
if [[ -x "/c/ffmpeg/bin/ffmpeg.exe" ]]; then
  FFMPEG="/c/ffmpeg/bin/ffmpeg.exe"
elif [[ -x "C:/ffmpeg/bin/ffmpeg.exe" ]]; then
  FFMPEG="C:/ffmpeg/bin/ffmpeg.exe"
fi

echo "FFmpeg: $FFMPEG"
echo "Input:  $INPUT (${DURATION}s)"

# Probe encoder preference (same order as Rust export.rs).
ENCODER="libx264"
PRESET_ARGS=(-preset veryfast -crf 23)
if "$FFMPEG" -hide_banner -encoders 2>/dev/null | grep -q h264_nvenc; then
  if "$FFMPEG" -hide_banner -loglevel error -f lavfi -i color=c=black:s=1280x720:d=0.04 -frames:v 1 -c:v h264_nvenc -preset p4 -cq 23 -f null - 2>/dev/null; then
    ENCODER="h264_nvenc"
    PRESET_ARGS=(-preset p4 -rc vbr -cq 23 -b:v 0)
  fi
fi
echo "Encoder: $ENCODER"

# Simulate single-crop TikTok export: center crop 9:16 + scale 1080x1920.
FILTER="crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=bicubic,setsar=1"

native_out="$OUT_DIR/native.mp4"
soft_out="$OUT_DIR/soft.mp4"
rm -f "$native_out" "$soft_out"

echo ""
echo "=== Native-style path ($ENCODER) ==="
START=$(date +%s.%N 2>/dev/null || powershell -NoProfile -Command "(Get-Date).Ticks")
"$FFMPEG" -y -hide_banner -ss 0 -t "$DURATION" -i "$INPUT" \
  -vf "$FILTER" \
  -c:v "$ENCODER" "${PRESET_ARGS[@]}" -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  "$native_out"
END=$(date +%s.%N 2>/dev/null || powershell -NoProfile -Command "(Get-Date).Ticks")
echo "Native wall time recorded above (see ffmpeg speed=)."

echo ""
echo "=== Software baseline (libx264 medium) — Canvas/WebCodecs-like cost class ==="
"$FFMPEG" -y -hide_banner -ss 0 -t "$DURATION" -i "$INPUT" \
  -vf "$FILTER" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  "$soft_out"

echo ""
echo "Outputs:"
ls -lh "$native_out" "$soft_out" 2>/dev/null || dir "$OUT_DIR"
echo ""
echo "Compare ffmpeg 'speed=' lines: native should be >> 1x realtime on NVENC;"
echo "target is typically 8–20× faster wall-clock than the WebView Canvas path."
