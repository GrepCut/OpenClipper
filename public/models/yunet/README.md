---
license: mit
pipeline_tag: object-detection
tags:
  - face-detection
  - yunet
  - onnx
  - onnxruntime
---

# YuNet Face Detection — 2026may (dynamic input)

Unmodified redistribution of `face_detection_yunet_2026may.onnx` from the
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet).

YuNet is a light-weight, fast and accurate face detection model (WIDER Face:
0.834 AP_easy / 0.824 AP_medium / 0.708 AP_hard) that detects faces of roughly
10×10 to 300×300 px. This is the dynamic-input-shape variant (the OpenCV Zoo
default): compatible with OpenCV 5.x's ONNX Runtime engine and any ONNX runtime,
allowing inference at any resolution without resizing. It is the same model with
symbolic height/width — the weights are identical to the fixed-shape
[2023mar](https://huggingface.co/pollen-robotics/face_detection_yunet_2023mar) variant.

## Input

`input` — float32 tensor `[1, 3, height, width]` (dynamic H/W): a BGR image, NCHW
layout, no normalization. `height` and `width` must be multiples of 32 (the largest stride).

## Output

12 per-stride detection heads for strides `s ∈ {8, 16, 32}`, each shaped `[1, A, C]`
with `A = (height/s) · (width/s)` anchors:

| tensor | shape | meaning |
|---|---|---|
| `cls_{s}`  | `[1, A, 1]`  | classification score |
| `obj_{s}`  | `[1, A, 1]`  | objectness score |
| `bbox_{s}` | `[1, A, 4]`  | bounding-box regression |
| `kps_{s}`  | `[1, A, 10]` | 5 landmarks — right eye, left eye, nose, right/left mouth corner — as (x, y) |

`cv2.FaceDetectorYN` (or an equivalent decode) turns these heads into per-face
`[x, y, w, h, 5 × (x, y), score]`.

## License

MIT, following the upstream
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md).

```bibtex
@article{wu2023yunet,
  title={YuNet: A Tiny Millisecond-level Face Detector},
  author={Wu, Wei and Peng, Hanyang and Yu, Shiqi},
  journal={Machine Intelligence Research},
  volume={20}, number={5}, pages={656--665}, year={2023}, publisher={Springer}
}
```
