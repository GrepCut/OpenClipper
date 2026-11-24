# Clipper vision model notices

## YOLOX-S

The bundled `yolox_s.onnx` and `yolox_s.fp16.onnx` files are dynamic-batch
WinML derivatives of the supplied YOLOX-S 640 ONNX export. Learned weights are
unchanged. YOLOX is distributed under the Apache License 2.0. See
<https://github.com/Megvii-BaseDetection/YOLOX>.

## YuNet (multiscale)

The bundled `yunet_fused_1536.onnx` (with `_landscape` and `_portrait`
siblings), `yunet_384.onnx` and `yunet_960.onnx` files are derivatives of
`face_detection_yunet_2026may.onnx` from the OpenCV Zoo
(<https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet>),
redistributed unmodified in `public/models/yunet/`. The derivatives fix the
input size per view, compute in float16, and the fused graphs combine three
copies of the network with in-graph resizing and mirroring. Learned weights
are unchanged. The derivatives are reproduced by
`scripts/models/prepare_yunet_multiscale.py`. YuNet is licensed under the
MIT License.

Copyright (c) 2020 Shiqi Yu <shiqi.yu@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

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
