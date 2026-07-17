#!/usr/bin/env python3
"""Derive batch-dynamic and fp16 variants of Clipper's WinML vision models.

Run after convert_clipper_vision_models.py. Two derivations, in place:

1. Dynamic batch: the exported graphs hardcode batch=1. WinML evaluates these
   tiny models one frame per call, so per-call dispatch overhead dominates
   GPU time. This script frees the batch dimension (input dim0 becomes the
   named free dimension "batch") and rewrites the affected Reshape shape
   constants: dim0 1 -> 0 ("copy from data input", Reshape-5 semantics, valid
   at opset 9). Constant-broadcast reshapes (e.g. [1,32,1,1] over bias
   tensors) are left untouched. The fp32 files are overwritten in place so
   the Rust side keeps its file names; a batch of 1 is bit-identical to the
   old models (validated below).

2. fp16 weight/compute variants ("<name>.fp16.onnx", graph inputs/outputs
   stay float32) which the Rust side only selects for the DirectX device.

Every derivation is parity-checked with onnxruntime before files or
manifest.json are touched.

Requires: onnx, onnxruntime, onnxconverter-common, numpy
  (pip install -r requirements-winml-models.txt onnxconverter-common)
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper
from onnxconverter_common import float16

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = REPO_ROOT / "src-tauri/resources/models/clipper-vision"
PARITY_BATCH = 3

# Absolute fp16-vs-fp32 tolerances. Regressors are in input-pixel units
# (~0..192 / 0..320), classifiers are logits clipped to about +-100, so these
# bounds keep decoded boxes/scores visually identical.
VARIANTS = {
    "blaze_face_full_range": {
        "input": {"name": "input", "shape": [192, 192, 3], "range": [-1.0, 1.0]},
        "fp16_atol": {"reshaped_regressor_face_4": 1.0, "reshaped_classifier_face_4": 0.25},
    },
    "autoflip_ssdlite": {
        "input": {
            "name": "normalized_input_image_tensor",
            "shape": [320, 320, 3],
            "range": [0.0, 255.0],
        },
        "fp16_atol": {
            "raw_outputs/box_encodings": 0.25,
            "raw_outputs/class_predictions": 0.25,
        },
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def deterministic_input(spec: dict, phase: int) -> np.ndarray:
    # Mirrors convert_clipper_vision_models.py (phase 0), with shifted phases
    # producing distinct-but-deterministic frames for batch parity checks.
    shape = spec["shape"]
    count = int(np.prod(shape))
    low, high = spec["range"]
    values = np.arange(count, dtype=np.float32)
    values = ((values * 37.0 + 17.0 + phase * 101.0) % 1021.0) / 1020.0
    return (values * (high - low) + low).reshape([1, *shape]).astype(np.float32)


def session_from(model: onnx.ModelProto) -> ort.InferenceSession:
    return ort.InferenceSession(
        model.SerializeToString(), providers=["CPUExecutionProvider"]
    )


def run(session: ort.InferenceSession, input_name: str, data: np.ndarray) -> dict:
    values = session.run(None, {input_name: data})
    return {output.name: value for output, value in zip(session.get_outputs(), values)}


def is_batch_dynamic(model: onnx.ModelProto) -> bool:
    dim = model.graph.input[0].type.tensor_type.shape.dim[0]
    return not (dim.HasField("dim_value") and dim.dim_value == 1)


def make_batch_dynamic(model: onnx.ModelProto) -> onnx.ModelProto:
    graph = model.graph
    initializers = {item.name: item for item in graph.initializer}
    rewritten = 0
    for node in graph.node:
        if node.op_type != "Reshape" or len(node.input) < 2:
            continue
        shape_init = initializers.get(node.input[1])
        if shape_init is None:
            continue
        target = numpy_helper.to_array(shape_init).copy()
        if target.ndim != 1 or target[0] != 1:
            continue
        # Every activation reshape carries the batch in dim0 (prediction
        # flattening, Relu6 lowering over 1x1 feature maps, graph outputs).
        # Only reshapes of constant tensors are batch-independent.
        if node.input[0] in initializers:
            continue
        target[0] = 0  # Reshape-5: copy dim0 from the data input (the batch)
        shape_init.CopyFrom(numpy_helper.from_array(target, shape_init.name))
        rewritten += 1
    if rewritten == 0:
        raise RuntimeError("no batch-carrying Reshape nodes found")
    for value in [graph.input[0], *graph.output]:
        dim = value.type.tensor_type.shape.dim[0]
        dim.Clear()
        dim.dim_param = "batch"
    onnx.checker.check_model(model, full_check=True)
    return model


def assert_batch_parity(
    reference: ort.InferenceSession,
    batched: ort.InferenceSession,
    spec: dict,
    label: str,
) -> dict:
    frames = [deterministic_input(spec, phase) for phase in range(PARITY_BATCH)]
    stacked = np.concatenate(frames, axis=0)
    batched_outputs = run(batched, spec["name"], stacked)
    max_error = 0.0
    for phase, frame in enumerate(frames):
        single = run(reference, spec["name"], frame)
        for output_name, expected in single.items():
            actual = batched_outputs[output_name][phase : phase + 1]
            difference = float(np.abs(actual - expected).max(initial=0.0))
            max_error = max(max_error, difference)
            if difference > 1e-4:
                raise RuntimeError(
                    f"{label}/{output_name}: batch element {phase} diverges by {difference}"
                )
    return {"batchSize": PARITY_BATCH, "maxAbsErrorVsSingle": max_error}


def main() -> None:
    manifest_path = MODEL_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    models = manifest["models"]

    for name, variant in VARIANTS.items():
        entry = models[name]
        spec = variant["input"]
        source = MODEL_DIR / entry["onnxFile"]
        model = onnx.load(source)

        if is_batch_dynamic(model):
            print(f"{name}: batch dimension already dynamic")
            batch_parity = entry.get("batchParity", {})
        else:
            reference = session_from(model)
            batched_model = make_batch_dynamic(model)
            batched = session_from(batched_model)
            batch_parity = assert_batch_parity(reference, batched, spec, name)
            onnx.save(batched_model, source)
            model = batched_model
            print(f"{name}: freed batch dim "
                  f"(max err vs single-frame: {batch_parity['maxAbsErrorVsSingle']:.3g})")

        fp16_model = float16.convert_float_to_float16(
            onnx.load(source), keep_io_types=True
        )
        onnx.checker.check_model(fp16_model, full_check=True)
        fp16_path = source.parent / source.name.replace(".onnx", ".fp16.onnx")
        onnx.save(fp16_model, fp16_path)

        fp32_session = session_from(model)
        fp16_session = session_from(fp16_model)
        stacked = np.concatenate(
            [deterministic_input(spec, phase) for phase in range(PARITY_BATCH)], axis=0
        )
        fp32_outputs = run(fp32_session, spec["name"], stacked)
        fp16_outputs = run(fp16_session, spec["name"], stacked)
        fp16_parity: dict[str, dict[str, float]] = {}
        for output_name, atol in variant["fp16_atol"].items():
            difference = np.abs(fp16_outputs[output_name] - fp32_outputs[output_name])
            max_error = float(difference.max(initial=0.0))
            if max_error > atol:
                raise RuntimeError(
                    f"{name}/{output_name}: fp16 max abs error {max_error} exceeds {atol}"
                )
            fp16_parity[output_name] = {
                "maxAbsErrorVsFp32": max_error,
                "meanAbsErrorVsFp32": float(difference.mean()),
            }
        print(f"{name}: wrote {fp16_path.name} (max errors: "
              + ", ".join(f"{k}={v['maxAbsErrorVsFp32']:.4g}" for k, v in fp16_parity.items())
              + ")")

        entry["onnxSha256"] = sha256(source)
        entry["dynamicBatch"] = True
        entry["batchParity"] = batch_parity
        models[f"{name}_fp16"] = {
            "derivedFrom": name,
            "onnxFile": fp16_path.name,
            "onnxSha256": sha256(fp16_path),
            "precision": "float16",
            "keepIoTypes": True,
            "dynamicBatch": True,
            "parityTolerance": variant["fp16_atol"],
            "parity": fp16_parity,
        }

    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"Updated {manifest_path}")


if __name__ == "__main__":
    main()
