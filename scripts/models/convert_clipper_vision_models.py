#!/usr/bin/env python3
"""Reproducibly convert Clipper's exact TFLite vision models for WinML.

BlazeFace contains fixed 2x half-pixel bilinear resizes. ONNX only gained a
native representation for that coordinate mode in opset 11, while the WinML
compatibility target is opset 9. The converter therefore lowers those three
fixed resizes to Gather/Mul/Add linear interpolation before validating parity.
No approximation or change of resize coordinates is made.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import tensorflow as tf
from onnx import TensorProto, helper, numpy_helper, shape_inference


REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_VERSION = "clipper-vision-v1"
OPSET = 9
MODELS: dict[str, dict[str, Any]] = {
    "blaze_face_full_range": {
        "source": "public/models/blaze_face_full_range/blaze_face_full_range.tflite",
        "sha256": "3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b",
        "onnx": "blaze_face_full_range.onnx",
        "input": {"name": "input", "shape": [1, 192, 192, 3], "dtype": "float32"},
        "outputs": [
            {"name": "reshaped_regressor_face_4", "shape": [1, 2304, 16], "dtype": "float32"},
            {"name": "reshaped_classifier_face_4", "shape": [1, 2304, 1], "dtype": "float32"},
        ],
        "preprocessing": {
            "resize": "bilinear-letterbox-square",
            "colorOrder": "rgb",
            "valueRange": [-1.0, 1.0],
            "layout": "nhwc",
        },
        "decoder": {
            "anchorCount": 2304,
            "strides": [4],
            "interpolatedScaleAspectRatio": 0.0,
            "minScale": 0.1484375,
            "maxScale": 0.75,
            "numLayers": 1,
            "numBoxes": 1,
            "xScale": 192.0,
            "yScale": 192.0,
            "wScale": 192.0,
            "hScale": 192.0,
            "scoreClippingThreshold": 100.0,
            "minRawScore": 0.55,
            "nmsIouThreshold": 0.4,
            "keypointCount": 6,
            "reverseOutputOrder": True,
        },
        "atol": 2e-4,
        "rtol": 2e-4,
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tensor_contract(detail: dict[str, Any]) -> dict[str, Any]:
    quant = detail.get("quantization_parameters", {})
    return {
        "name": detail["name"],
        "shape": [int(value) for value in detail["shape"]],
        "dtype": np.dtype(detail["dtype"]).name,
        "quantization": {
            "scales": np.asarray(quant.get("scales", [])).astype(float).tolist(),
            "zeroPoints": np.asarray(quant.get("zero_points", [])).astype(int).tolist(),
            "dimension": int(quant.get("quantized_dimension", 0)),
        },
    }


def assert_contract(actual: dict[str, Any], expected: dict[str, Any], model: str) -> None:
    for key in ("name", "shape", "dtype"):
        if actual[key] != expected[key]:
            raise RuntimeError(f"{model}: {key} changed: {actual[key]!r} != {expected[key]!r}")


def deterministic_input(spec: dict[str, Any]) -> np.ndarray:
    shape = spec["input"]["shape"]
    count = int(np.prod(shape))
    low, high = spec["preprocessing"]["valueRange"]
    # A non-repeating, deterministic signal exercises edges and resize paths.
    values = np.arange(count, dtype=np.float32)
    values = ((values * 37.0 + 17.0) % 1021.0) / 1020.0
    return (values * (high - low) + low).reshape(shape).astype(np.float32)


def run_tflite(path: Path, input_data: np.ndarray) -> dict[str, np.ndarray]:
    interpreter = tf.lite.Interpreter(model_path=str(path), num_threads=1)
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    interpreter.set_tensor(input_detail["index"], input_data)
    interpreter.invoke()
    return {
        detail["name"]: interpreter.get_tensor(detail["index"])
        for detail in interpreter.get_output_details()
    }


def value_shapes(model: onnx.ModelProto) -> dict[str, list[int]]:
    inferred = shape_inference.infer_shapes(model)
    result: dict[str, list[int]] = {}
    for value in list(inferred.graph.input) + list(inferred.graph.value_info) + list(inferred.graph.output):
        dims = value.type.tensor_type.shape.dim
        if all(dim.HasField("dim_value") for dim in dims):
            result[value.name] = [int(dim.dim_value) for dim in dims]
    return result


def lower_half_pixel_resize_to_opset9(model: onnx.ModelProto) -> onnx.ModelProto:
    """Lower fixed NCHW half-pixel 2x Resize nodes without changing math."""
    shapes = value_shapes(model)
    initializers = {item.name: numpy_helper.to_array(item) for item in model.graph.initializer}
    rewritten: list[onnx.NodeProto] = []
    added_initializers: list[onnx.TensorProto] = []
    lowered = 0

    for node in model.graph.node:
        # Pad moved its pads/value attributes to tensor inputs in opset 11.
        # tf2onnx emits constant inputs, so the opset-9 form is lossless.
        if node.op_type == "Pad" and len(node.input) >= 2:
            pads = initializers.get(node.input[1])
            if pads is None:
                raise RuntimeError(f"Pad {node.name} does not have constant pads")
            attributes: dict[str, Any] = {"pads": [int(value) for value in pads.flat], "mode": "constant"}
            if len(node.input) >= 3:
                value = initializers.get(node.input[2])
                if value is None or value.size != 1:
                    raise RuntimeError(f"Pad {node.name} does not have a constant scalar value")
                attributes["value"] = float(value.flat[0])
            rewritten.append(helper.make_node("Pad", [node.input[0]], list(node.output), name=node.name, **attributes))
            continue
        if node.op_type != "Resize":
            rewritten.append(node)
            continue
        attrs = {item.name: helper.get_attribute_value(item) for item in node.attribute}
        if attrs.get("mode") != b"linear" or attrs.get("coordinate_transformation_mode") != b"half_pixel":
            raise RuntimeError(f"Unsupported Resize contract in {node.name}")
        input_shape = shapes.get(node.input[0])
        output_shape = shapes.get(node.output[0])
        if not input_shape or not output_shape or len(input_shape) != 4:
            raise RuntimeError(f"Resize {node.name} is not fixed-shape NCHW")

        current = node.input[0]
        for axis in (2, 3):
            source_size = input_shape[axis]
            target_size = output_shape[axis]
            scale = target_size / source_size
            coords = (np.arange(target_size, dtype=np.float32) + 0.5) / scale - 0.5
            lower = np.floor(coords).astype(np.int64)
            upper = lower + 1
            upper_weight = coords - np.floor(coords)
            lower = np.clip(lower, 0, source_size - 1)
            upper = np.clip(upper, 0, source_size - 1)
            lower_weight = 1.0 - upper_weight

            prefix = f"{node.name}_axis{axis}"
            names = {
                "lo_idx": f"{prefix}_lower_indices",
                "hi_idx": f"{prefix}_upper_indices",
                "lo_w": f"{prefix}_lower_weights",
                "hi_w": f"{prefix}_upper_weights",
                "lo": f"{prefix}_lower",
                "hi": f"{prefix}_upper",
                "lo_mul": f"{prefix}_lower_weighted",
                "hi_mul": f"{prefix}_upper_weighted",
                "out": node.output[0] if axis == 3 else f"{prefix}_output",
            }
            weight_shape = [1, 1, target_size, 1] if axis == 2 else [1, 1, 1, target_size]
            added_initializers.extend([
                numpy_helper.from_array(lower, names["lo_idx"]),
                numpy_helper.from_array(upper, names["hi_idx"]),
                numpy_helper.from_array(lower_weight.reshape(weight_shape).astype(np.float32), names["lo_w"]),
                numpy_helper.from_array(upper_weight.reshape(weight_shape).astype(np.float32), names["hi_w"]),
            ])
            rewritten.extend([
                helper.make_node("Gather", [current, names["lo_idx"]], [names["lo"]], axis=axis, name=f"{prefix}_gather_lower"),
                helper.make_node("Gather", [current, names["hi_idx"]], [names["hi"]], axis=axis, name=f"{prefix}_gather_upper"),
                helper.make_node("Mul", [names["lo"], names["lo_w"]], [names["lo_mul"]], name=f"{prefix}_mul_lower"),
                helper.make_node("Mul", [names["hi"], names["hi_w"]], [names["hi_mul"]], name=f"{prefix}_mul_upper"),
                helper.make_node("Add", [names["lo_mul"], names["hi_mul"]], [names["out"]], name=f"{prefix}_add"),
            ])
            current = names["out"]
        lowered += 1

    if lowered != 3:
        raise RuntimeError(f"BlazeFace Resize contract changed: lowered {lowered}, expected 3")
    del model.graph.node[:]
    model.graph.node.extend(rewritten)
    model.graph.initializer.extend(added_initializers)
    for opset in model.opset_import:
        if opset.domain in ("", "ai.onnx"):
            opset.version = OPSET
    model.ir_version = min(model.ir_version, 6)
    return model


def convert(source: Path, destination: Path, lower_resize: bool) -> None:
    conversion_opset = 11 if lower_resize else OPSET
    with tempfile.TemporaryDirectory(prefix="openclipper-winml-") as temp_dir:
        temporary = Path(temp_dir) / "converted.onnx"
        env = os.environ.copy()
        env.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
        subprocess.run([
            sys.executable, "-m", "tf2onnx.convert", "--tflite", str(source),
            "--output", str(temporary), "--opset", str(conversion_opset),
        ], check=True, env=env)
        model = onnx.load(temporary)
        if lower_resize:
            model = lower_half_pixel_resize_to_opset9(model)
        onnx.checker.check_model(model, full_check=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        onnx.save(model, destination)


def compare_outputs(spec: dict[str, Any], source: Path, destination: Path) -> dict[str, Any]:
    input_data = deterministic_input(spec)
    tflite_outputs = run_tflite(source, input_data)
    session = ort.InferenceSession(str(destination), providers=["CPUExecutionProvider"])
    onnx_values = session.run(None, {spec["input"]["name"]: input_data})
    onnx_outputs = {item.name: value for item, value in zip(session.get_outputs(), onnx_values)}
    metrics: dict[str, Any] = {}
    for output in spec["outputs"]:
        name = output["name"]
        expected = tflite_outputs[name]
        actual = onnx_outputs[name]
        np.testing.assert_allclose(actual, expected, atol=spec["atol"], rtol=spec["rtol"])
        difference = np.abs(actual - expected)
        metrics[name] = {
            "maxAbsError": float(difference.max(initial=0.0)),
            "meanAbsError": float(difference.mean()),
            "tfliteOutputSha256": hashlib.sha256(expected.tobytes()).hexdigest(),
            "onnxOutputSha256": hashlib.sha256(actual.tobytes()).hexdigest(),
        }
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "src-tauri/resources/models/clipper-vision",
    )
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "modelVersion": MODEL_VERSION,
        "onnxOpset": OPSET,
        "conversion": {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "tensorflow": tf.__version__,
            "tf2onnx": __import__("tf2onnx").__version__,
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
        },
        "models": {},
    }

    for name, spec in MODELS.items():
        source = REPO_ROOT / spec["source"]
        actual_hash = sha256(source)
        if actual_hash != spec["sha256"]:
            raise RuntimeError(f"{name}: source SHA-256 changed: {actual_hash}")
        interpreter = tf.lite.Interpreter(model_path=str(source), num_threads=1)
        interpreter.allocate_tensors()
        actual_input = tensor_contract(interpreter.get_input_details()[0])
        assert_contract(actual_input, spec["input"], name)
        actual_outputs = [tensor_contract(item) for item in interpreter.get_output_details()]
        if len(actual_outputs) != len(spec["outputs"]):
            raise RuntimeError(f"{name}: output count changed")
        for actual, expected in zip(actual_outputs, spec["outputs"]):
            assert_contract(actual, expected, name)

        destination = output_dir / spec["onnx"]
        convert(source, destination, lower_resize=name == "blaze_face_full_range")
        parity = compare_outputs(spec, source, destination)
        manifest["models"][name] = {
            "sourcePath": spec["source"],
            "sourceSha256": actual_hash,
            "onnxFile": spec["onnx"],
            "onnxSha256": sha256(destination),
            "input": actual_input,
            "outputs": actual_outputs,
            "preprocessing": spec["preprocessing"],
            "decoder": spec["decoder"],
            "parityTolerance": {"absolute": spec["atol"], "relative": spec["rtol"]},
            "parity": parity,
        }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    main()
