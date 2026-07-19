#!/usr/bin/env python3
"""Create the deterministic dynamic-batch WinML YOLOX-Tiny resource."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/models/yolox_tiny/yolox_tiny.onnx"
DESTINATION = ROOT / "src-tauri/resources/models/clipper-vision/yolox_tiny.onnx"
EXPECTED_SOURCE_SHA256 = "427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def session(model: onnx.ModelProto) -> ort.InferenceSession:
    return ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"])


def make_dynamic(source: onnx.ModelProto) -> onnx.ModelProto:
    model = onnx.ModelProto()
    model.CopyFrom(source)
    initializers = {initializer.name: initializer for initializer in model.graph.initializer}
    rewritten = 0
    for node in model.graph.node:
        if node.op_type != "Reshape" or len(node.input) < 2:
            continue
        shape = initializers.get(node.input[1])
        if shape is None or node.input[0] in initializers:
            continue
        value = numpy_helper.to_array(shape).copy()
        if value.ndim == 1 and len(value) and value[0] == 1:
            value[0] = 0
            shape.CopyFrom(numpy_helper.from_array(value, shape.name))
            rewritten += 1
    if rewritten == 0:
        raise RuntimeError("YOLOX graph has no batch-carrying Reshape initializer")
    for value in [*model.graph.input, *model.graph.output]:
        dimension = value.type.tensor_type.shape.dim[0]
        dimension.Clear()
        dimension.dim_param = "batch"
    # Static intermediate annotations from the batch=1 export can override
    # shape inference in WinML even after graph inputs/outputs are dynamic.
    del model.graph.value_info[:]
    onnx.checker.check_model(model, full_check=True)
    return model


def deterministic_frame(phase: int) -> np.ndarray:
    values = np.arange(3 * 416 * 416, dtype=np.float32)
    values = ((values * 37.0 + 17.0 + phase * 101.0) % 1021.0) / 4.0
    return values.reshape(1, 3, 416, 416)


def main() -> None:
    if sha256(SOURCE) != EXPECTED_SOURCE_SHA256:
        raise RuntimeError("Unexpected YOLOX source SHA-256")
    original = onnx.load(SOURCE)
    derived = make_dynamic(original)
    original_session = session(original)
    derived_session = session(derived)
    input_name = original_session.get_inputs()[0].name
    output_name = original_session.get_outputs()[0].name
    frames = [deterministic_frame(index) for index in range(2)]
    actual = derived_session.run([output_name], {input_name: np.concatenate(frames)})[0]
    maximum_error = 0.0
    for index, frame in enumerate(frames):
        expected = original_session.run([output_name], {input_name: frame})[0]
        maximum_error = max(maximum_error, float(np.max(np.abs(actual[index:index + 1] - expected))))
    if maximum_error > 1e-5:
        raise RuntimeError(f"Dynamic batch parity failed: max abs error {maximum_error}")
    onnx.save(derived, DESTINATION)
    print(f"Wrote {DESTINATION}")
    print(f"sha256={sha256(DESTINATION)} batchParityMaxAbsError={maximum_error}")


if __name__ == "__main__":
    main()
