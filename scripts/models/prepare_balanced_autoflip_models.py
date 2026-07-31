#!/usr/bin/env python3
"""Prepare user-supplied YOLOX-S and SCRFD-10G models for WinML.

The source exports are kept unchanged. This script creates dynamic-batch fp32
and mixed-fp16 derivatives, validates batch parity with ONNX Runtime, and
copies the deployable artifacts into the Tauri clipper-vision bundle.

Requires: numpy, onnx, onnxruntime, onnxconverter-common
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper
from onnxconverter_common import float16


ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "src-tauri/resources/models/clipper-vision"
BATCH_PARITY_SIZE = 2

YOLOX_SOURCE = ROOT / "public/models/yolox_s/yolox_s.onnx"
YOLOX_BUNDLE_FP32 = BUNDLE / "yolox_s.onnx"
YOLOX_BUNDLE_FP16 = BUNDLE / "yolox_s.fp16.onnx"

SCRFD_SOURCE = ROOT / "public/models/scrfd_10g/scrfd_10g_bnkps.onnx"
SCRFD_BUNDLE_FP32 = BUNDLE / "scrfd_10g_bnkps.onnx"
SCRFD_BUNDLE_FP16 = BUNDLE / "scrfd_10g_bnkps.fp16.onnx"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def session(model: onnx.ModelProto) -> ort.InferenceSession:
    return ort.InferenceSession(
        model.SerializeToString(), providers=["CPUExecutionProvider"]
    )


def deterministic_input(shape: tuple[int, ...], phase: int) -> np.ndarray:
    count = int(np.prod(shape))
    values = np.arange(count, dtype=np.float32)
    values = ((values * 37.0 + 17.0 + phase * 101.0) % 1021.0) / 1020.0
    return values.reshape((1, *shape))


def clear_dimension(dimension: onnx.TensorShapeProto.Dimension, name: str) -> None:
    dimension.Clear()
    dimension.dim_param = name


def validate_contracts(yolox: onnx.ModelProto, scrfd: onnx.ModelProto) -> None:
    y_input = yolox.graph.input[0]
    y_shape = [dimension.dim_value for dimension in y_input.type.tensor_type.shape.dim]
    y_outputs = [(item.name, [d.dim_value for d in item.type.tensor_type.shape.dim]) for item in yolox.graph.output]
    if y_input.name != "images" or y_shape != [1, 3, 640, 640] or y_outputs != [("output", [1, 8400, 85])]:
        raise RuntimeError(f"Unexpected YOLOX-S contract: input={y_input.name, y_shape}, outputs={y_outputs}")

    s_input = scrfd.graph.input[0]
    output_shapes = [[d.dim_value for d in item.type.tensor_type.shape.dim] for item in scrfd.graph.output]
    expected = [
        [12800, 1], [3200, 1], [800, 1],
        [12800, 4], [3200, 4], [800, 4],
        [12800, 10], [3200, 10], [800, 10],
    ]
    if s_input.name != "input.1" or len(scrfd.graph.output) != 9 or output_shapes != expected:
        raise RuntimeError(f"Unexpected SCRFD-10G-KPS contract: input={s_input.name}, outputs={output_shapes}")


def make_yolox_dynamic(source: onnx.ModelProto) -> onnx.ModelProto:
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
    clear_dimension(model.graph.input[0].type.tensor_type.shape.dim[0], "batch")
    clear_dimension(model.graph.output[0].type.tensor_type.shape.dim[0], "batch")
    del model.graph.value_info[:]
    onnx.checker.check_model(model, full_check=True)
    return model


def make_scrfd_dynamic(source: onnx.ModelProto) -> onnx.ModelProto:
    model = onnx.ModelProto()
    model.CopyFrom(source)
    clear_dimension(model.graph.input[0].type.tensor_type.shape.dim[0], "batch")
    # SCRFD flattens batch and anchors into output dim0. Do not call that
    # dimension "batch", otherwise WinML's named-dimension override would
    # incorrectly bind it to 8 instead of 8 * anchor_count.
    for index, output in enumerate(model.graph.output):
        clear_dimension(output.type.tensor_type.shape.dim[0], f"batch_anchors_{index}")
    del model.graph.value_info[:]
    onnx.checker.check_model(model, full_check=True)
    return model


def assert_batch_parity(
    reference_model: onnx.ModelProto,
    dynamic_model: onnx.ModelProto,
    input_shape: tuple[int, ...],
    label: str,
    interleaved_anchors: int | None = None,
) -> float:
    reference = session(reference_model)
    dynamic = session(dynamic_model)
    input_name = reference.get_inputs()[0].name
    frames = [deterministic_input(input_shape, phase) for phase in range(BATCH_PARITY_SIZE)]
    actual_outputs = dynamic.run(None, {input_name: np.concatenate(frames, axis=0)})
    max_error = 0.0
    for batch_index, frame in enumerate(frames):
        expected_outputs = reference.run(None, {input_name: frame})
        for output_index, expected in enumerate(expected_outputs):
            actual = actual_outputs[output_index]
            if interleaved_anchors is not None:
                # SCRFD transposes NCHW to HWNC before flattening. Rows are
                # therefore grouped as [spatial, batch, anchor, values], not
                # as one contiguous block per batch element.
                spatial = expected.shape[0] // interleaved_anchors
                selected = actual.reshape(
                    spatial,
                    BATCH_PARITY_SIZE,
                    interleaved_anchors,
                    expected.shape[1],
                )[:, batch_index, :, :].reshape(expected.shape)
            else:
                rows_per_batch = actual.shape[0] // BATCH_PARITY_SIZE
                selected = actual[batch_index * rows_per_batch:(batch_index + 1) * rows_per_batch]
                if expected.ndim == actual.ndim and expected.shape[0] == 1:
                    selected = selected[np.newaxis, ...]
            difference = float(np.max(np.abs(selected - expected), initial=0.0))
            max_error = max(max_error, difference)
    if max_error > 1e-4:
        raise RuntimeError(f"{label}: dynamic batch parity failed, max abs error={max_error}")
    return max_error


def make_fp16(fp32: onnx.ModelProto) -> onnx.ModelProto:
    converted = float16.convert_float_to_float16(fp32, keep_io_types=True)
    onnx.checker.check_model(converted, full_check=True)
    return converted


def assert_fp16_parity(
    fp32_model: onnx.ModelProto,
    fp16_model: onnx.ModelProto,
    input_shape: tuple[int, ...],
    label: str,
) -> tuple[float, float]:
    fp32_session = session(fp32_model)
    fp16_session = session(fp16_model)
    input_name = fp32_session.get_inputs()[0].name
    data = deterministic_input(input_shape, 7)
    expected_outputs = fp32_session.run(None, {input_name: data})
    actual_outputs = fp16_session.run(None, {input_name: data})
    maximum = 0.0
    means: list[float] = []
    for expected, actual in zip(expected_outputs, actual_outputs):
        difference = np.abs(actual - expected)
        maximum = max(maximum, float(difference.max(initial=0.0)))
        means.append(float(difference.mean()))
        if not np.allclose(actual, expected, rtol=0.02, atol=0.2):
            raise RuntimeError(f"{label}: fp16 parity failed, max abs error={maximum}")
    return maximum, max(means, default=0.0)


def save_pair(
    fp32_model: onnx.ModelProto,
    fp16_model: onnx.ModelProto,
    bundle_fp32: Path,
    bundle_fp16: Path,
) -> None:
    BUNDLE.mkdir(parents=True, exist_ok=True)
    onnx.save(fp32_model, bundle_fp32)
    onnx.save(fp16_model, bundle_fp16)


def report(label: str, paths: tuple[Path, Path], batch_error: float, fp16_error: tuple[float, float]) -> None:
    print(f"{label}: batch parity max abs error={batch_error:.6g}")
    print(f"{label}: fp16 max/mean abs error={fp16_error[0]:.6g}/{fp16_error[1]:.6g}")
    for path in paths:
        print(f"{path.relative_to(ROOT)} sha256={sha256(path)} bytes={path.stat().st_size}")


def main() -> None:
    yolox_source = onnx.load(YOLOX_SOURCE)
    scrfd_source = onnx.load(SCRFD_SOURCE)
    validate_contracts(yolox_source, scrfd_source)

    yolox_dynamic = make_yolox_dynamic(yolox_source)
    yolox_batch_error = assert_batch_parity(
        yolox_source, yolox_dynamic, (3, 640, 640), "YOLOX-S"
    )
    yolox_fp16 = make_fp16(yolox_dynamic)
    yolox_fp16_error = assert_fp16_parity(
        yolox_dynamic, yolox_fp16, (3, 640, 640), "YOLOX-S"
    )
    save_pair(
        yolox_dynamic, yolox_fp16,
        YOLOX_BUNDLE_FP32, YOLOX_BUNDLE_FP16,
    )

    scrfd_dynamic = make_scrfd_dynamic(scrfd_source)
    scrfd_batch_error = assert_batch_parity(
        scrfd_source,
        scrfd_dynamic,
        (3, 640, 640),
        "SCRFD-10G-KPS",
        interleaved_anchors=2,
    )
    scrfd_fp16 = make_fp16(scrfd_dynamic)
    scrfd_fp16_error = assert_fp16_parity(
        scrfd_dynamic, scrfd_fp16, (3, 640, 640), "SCRFD-10G-KPS"
    )
    save_pair(
        scrfd_dynamic, scrfd_fp16,
        SCRFD_BUNDLE_FP32, SCRFD_BUNDLE_FP16,
    )

    report(
        "YOLOX-S",
        (YOLOX_BUNDLE_FP32, YOLOX_BUNDLE_FP16),
        yolox_batch_error,
        yolox_fp16_error,
    )
    report(
        "SCRFD-10G-KPS",
        (SCRFD_BUNDLE_FP32, SCRFD_BUNDLE_FP16),
        scrfd_batch_error,
        scrfd_fp16_error,
    )


if __name__ == "__main__":
    main()
