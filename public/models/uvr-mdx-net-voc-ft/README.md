# UVR-MDX-NET-Voc_FT (ONNX)

Vocals isolation model used before ASR when Isolate vocals is on.
Weights are not committed (large). Sideload to AppData:

```powershell
$dest = "$env:APPDATA\com.openclipper.app\models\uvr-mdx-net-voc-ft"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# copy config.json + UVR-MDX-NET-Voc_FT.onnx into $dest
```

Source: https://github.com/TRvlvr/model_repo/releases/tag/all_public_uvr_models  
File: `UVR-MDX-NET-Voc_FT.onnx` (~67 MB)  
SHA-256: `534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111`

Params (UVR `model_data`): `n_fft=7680`, `dim_f=3072`, `dim_t=256`, `hop=1024`.
