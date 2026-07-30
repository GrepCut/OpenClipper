# GPU caption parity smoke test (requires Tauri shell + wgpu)
# Renders phrase presets via Canvas in the browser devtools console using caption-gpu-parity.util.ts
# and compares against native PNG frames from export temp dir after a short native export.

Write-Host "GPU caption parity: run from app with captions enabled, or use:"
Write-Host "  cargo test -p open-clipper probe_gpu_smoke -- --nocapture"
Write-Host "See open-clipper/src/features/clipper/engine/render/caption-gpu-parity.util.ts"
