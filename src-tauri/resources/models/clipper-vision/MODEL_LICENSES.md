# Clipper vision model notices

## LR-ASD

The bundled `lr_asd_ava.onnx` is a deterministic ONNX export of the supplied
LR-ASD AVA checkpoint. LR-ASD is distributed under the MIT License. See
<https://github.com/Junhua-Liao/LR-ASD>.

## YOLOX-Tiny and YOLOX-S

The bundled `yolox_tiny.onnx` is a dynamic-batch derivation of the supplied
YOLOX-Tiny weights. Learned weights are unchanged. YOLOX is distributed under
the Apache License 2.0. See <https://github.com/Megvii-BaseDetection/YOLOX>.

The bundled `yolox_s.onnx` and `yolox_s.fp16.onnx` files are dynamic-batch
WinML derivatives of the supplied YOLOX-S 640 ONNX export. Learned weights are
unchanged.

The bundled `blaze_face_full_range.onnx` file is a reproducible conversion of
the MediaPipe model asset already shipped under `public/models/`. It is used
locally by Windows Machine Learning and is not downloaded at runtime.

MediaPipe is licensed under the Apache License 2.0. The converted files retain
the same model provenance and are generated without changing learned weights.
See <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>.

## SCRFD-10G-KPS

The bundled `scrfd_10g_bnkps.onnx` and `scrfd_10g_bnkps.fp16.onnx` files are
dynamic-batch WinML derivatives of the supplied InsightFace SCRFD-10G-KPS
ONNX export. The model detects faces and five facial landmarks.

InsightFace's pretrained model notice restricts its model-zoo weights to
non-commercial research use. Commercial distribution requires separately
licensed or independently trained weights. See
<https://github.com/deepinsight/insightface/tree/master/model_zoo>.

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

Feeds person re-identification embeddings used by canonical-person track
association across frames.

## TransNetV2

The bundled `transnetv2.onnx` is a deterministic ONNX export of the TransNetV2
shot-boundary model. TransNetV2 is distributed under the Apache License 2.0.
See <https://github.com/soCzech/TransNetV2>.

Drives production scene-cut resets for the AutoFlip tracker.

## ViNet-S

The bundled `vinet-s-saliency.onnx` is a deterministic ONNX export of the
ViNet++ ViNet-S saliency checkpoint (SHA256
`803e6d265d46d3f4f3d7ec2c6c2f3b4511f9ba176aa12e348ac317788ca0dc68`).
ViNet++ is distributed under CC BY-NC-SA 4.0. See
`reference-algorithms/video-saliency/vinet-v2/`.

Feeds the `video-saliency` importance signal used in crop framing decisions.
