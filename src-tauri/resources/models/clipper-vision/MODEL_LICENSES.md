# Clipper vision model notices

The bundled `blaze_face_full_range.onnx` and `ssdlite_object_detection.onnx`
files are reproducible conversions of the MediaPipe model assets already
shipped under `public/models/`. They are used locally by Windows
Machine Learning and are not downloaded at runtime.

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
