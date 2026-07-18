#!/usr/bin/env python3
"""Convert MoveNet MultiPose Lightning SavedModel for WinML and record parity.

The upstream model accepts int32 RGB tensors with dynamic spatial dimensions.
WinML's shared vision wrapper binds TensorFloat, so the exported ONNX graph
adds a float32 public input and casts it to the model's original int32 input.
The pose worker intentionally evaluates one 512x512 frame per call because the
upstream model fixes its batch dimension to one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import onnx
import onnxruntime as ort
import tensorflow as tf
from onnx import TensorProto, helper

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = REPO_ROOT / "src-tauri/resources/models/clipper-vision"
MODEL_URL = "https://www.kaggle.com/models/google/movenet/tensorFlow2/multipose-lightning/1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_float_input_cast(model: onnx.ModelProto) -> onnx.ModelProto:
    graph = model.graph
    source = graph.input[0]
    if source.type.tensor_type.elem_type != TensorProto.INT32:
        raise RuntimeError("MoveNet input contract changed: expected int32")
    public_name = source.name
    cast_name = f"{public_name}_int32"
    for node in graph.node:
        for index, value in enumerate(node.input):
            if value == public_name:
                node.input[index] = cast_name
    source.type.tensor_type.elem_type = TensorProto.FLOAT
    graph.node.insert(0, helper.make_node("Cast", [public_name], [cast_name], to=TensorProto.INT32, name="CastInputToInt32"))
    onnx.checker.check_model(model, full_check=True)
    return model


def run_onnx(path: Path, values: np.ndarray) -> np.ndarray:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return session.run(None, {session.get_inputs()[0].name: values.astype(np.float32)})[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("saved_model", type=Path)
    parser.add_argument("--source-archive", type=Path)
    args = parser.parse_args()
    if not (args.saved_model / "saved_model.pb").is_file():
        raise SystemExit(f"Not a SavedModel: {args.saved_model}")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    fp32_path = MODEL_DIR / "movenet_multipose_lightning.onnx"
    temporary = MODEL_DIR / "movenet_multipose_lightning.converted.onnx"
    subprocess.run([
        sys.executable, "-m", "tf2onnx.convert",
        "--saved-model", str(args.saved_model),
        "--signature_def", "serving_default",
        "--opset", "15",
        "--output", str(temporary),
    ], check=True)
    model = add_float_input_cast(onnx.load(temporary))
    onnx.save(model, fp32_path)
    temporary.unlink(missing_ok=True)

    rng = np.random.default_rng(12345)
    input_int = rng.integers(0, 256, size=(1, 512, 512, 3), dtype=np.int32)
    signature = tf.saved_model.load(str(args.saved_model)).signatures["serving_default"]
    expected = signature(input=tf.convert_to_tensor(input_int))["output_0"].numpy()
    actual = run_onnx(fp32_path, input_int)
    difference = np.abs(actual - expected)
    max_error = float(difference.max(initial=0.0))
    mean_error = float(difference.mean())
    if max_error > 0.002:
        raise RuntimeError(f"MoveNet ONNX parity failed: max abs error {max_error}")

    manifest_path = MODEL_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["modelVersion"] = "clipper-vision-v2"
    manifest["onnxOpset"] = max(int(manifest.get("onnxOpset", 0)), 15)
    manifest["models"]["movenet_multipose_lightning"] = {
        "sourceUrl": MODEL_URL,
        "sourceArchiveSha256": sha256(args.source_archive) if args.source_archive else None,
        "onnxFile": fp32_path.name,
        "onnxSha256": sha256(fp32_path),
        "dynamicBatch": False,
        "input": {"name": "input", "dtype": "float32", "shape": [1, 512, 512, 3]},
        "outputs": [{"name": "output_0", "dtype": "float32", "shape": [1, 6, 56]}],
        "preprocessing": {"colorOrder": "rgb", "layout": "nhwc", "resize": "bilinear-letterbox-square", "valueRange": [0.0, 255.0]},
        "decoder": {"poseCount": 6, "keypointCount": 17, "instanceSize": 56, "poseScoreThreshold": 0.15, "keypointScoreThreshold": 0.2, "minimumKeypoints": 4},
        "parityTolerance": {"absolute": 0.002},
        "parity": {"maxAbsError": max_error, "meanAbsError": mean_error},
    }
    # Keep this model in fp32. Generic graph-wide fp16 conversion changes
    # MoveNet's shape/control subgraph types and is rejected by ONNX/WinML.
    manifest["models"].pop("movenet_multipose_lightning_fp16", None)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {fp32_path.name} and {manifest_path.name}")


if __name__ == "__main__":
    main()
