# Clipper vision model notices

## YOLOX-S

The bundled `yolox_s.onnx` and `yolox_s.fp16.onnx` files are dynamic-batch
WinML derivatives of the supplied YOLOX-S 640 ONNX export. Learned weights are
unchanged. YOLOX is distributed under the Apache License 2.0. See
<https://github.com/Megvii-BaseDetection/YOLOX>.

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
