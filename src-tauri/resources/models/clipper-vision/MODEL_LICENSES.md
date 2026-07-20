# Clipper vision model notices

## Light-ASD

The bundled `light_asd_ava.onnx` is an ONNX export of the supplied AVA
checkpoint from Light-ASD. Light-ASD is distributed under the MIT License.
See <https://github.com/Junhua-Liao/Light-ASD>.

## LR-ASD

The bundled `lr_asd_ava.onnx` is a deterministic ONNX export of the supplied
LR-ASD AVA checkpoint. LR-ASD is distributed under the MIT License. See
<https://github.com/Junhua-Liao/LR-ASD>.

## YOLOX-Tiny

The bundled `yolox_tiny.onnx` is a dynamic-batch derivation of the supplied
YOLOX-Tiny weights. Learned weights are unchanged. YOLOX is distributed under
the Apache License 2.0. See <https://github.com/Megvii-BaseDetection/YOLOX>.

The bundled `blaze_face_full_range.onnx` file is a reproducible conversion of
the MediaPipe model asset already shipped under `public/models/`. It is used
locally by Windows Machine Learning and is not downloaded at runtime.

MediaPipe is licensed under the Apache License 2.0. The converted files retain
the same model provenance and are generated without changing learned weights.
See <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>.

## MoveNet MultiPose Lightning

The bundled `movenet_multipose_lightning.onnx` file is derived from the Google
MoveNet MultiPose Lightning model. It runs locally through WinML and is not
downloaded at runtime.

MoveNet and the TensorFlow.js pose-detection implementation are distributed
under the Apache License 2.0. See
<https://www.kaggle.com/models/google/movenet/tensorFlow2/multipose-lightning/1>.

## ByteTrack

The native AutoFlip tracker includes an adapted implementation of the
ByteTrack association algorithm. ByteTrack is licensed under the MIT License.

Copyright (c) 2021 Yifu Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions: The above copyright
notice and this permission notice shall be included in all copies or
substantial portions of the Software.

## OSNet x0.25

The bundled `osnet_x0_25_msmt17.onnx` is a deterministic ONNX export of the
OSNet x0.25 MSMT17 checkpoint from deep-person-reid. OSNet is distributed
under the MIT License. See <https://github.com/KaiyangZhou/deep-person-reid>.

Used in shadow mode only (adaptive ReID diagnostics); layout routing is
unchanged unless explicitly promoted.

## TransNetV2

The bundled `transnetv2.onnx` is a deterministic ONNX export of the TransNetV2
shot-boundary model. TransNetV2 is distributed under the Apache License 2.0.
See <https://github.com/soCzech/TransNetV2>.

Used in shadow mode only (cut-detection diagnostics); production scene cuts
still come from the histogram `AutoFlipShotBoundaryDetector` until promoted.

## OSNet x0.5

The bundled `osnet_x0_5_msmt17.onnx` is a deterministic ONNX export of the
OSNet x0.5 MSMT17 combineall checkpoint from deep-person-reid (SHA256
`e96cbd20ee9cc3c6dcc0e8f4fbba8c8069d47647a5a96a59ce381fb785c54f68`).
OSNet is distributed under the MIT License. See
<https://github.com/KaiyangZhou/deep-person-reid>.

Used in shadow mode only (adaptive ReID diagnostics); layout routing is
unchanged unless explicitly promoted.

## ViNet-S

The bundled `vinet-s-saliency.onnx` is a deterministic ONNX export of the
ViNet++ ViNet-S saliency checkpoint (SHA256
`803e6d265d46d3f4f3d7ec2c6c2f3b4511f9ba176aa12e348ac317788ca0dc68`).
ViNet++ is distributed under CC BY-NC-SA 4.0. See
`reference-algorithms/video-saliency/vinet-v2/`.

Used in shadow mode only (temporal video-saliency diagnostics); layout routing
is unchanged unless explicitly promoted.
