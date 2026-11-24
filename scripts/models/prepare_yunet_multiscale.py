#!/usr/bin/env python3
"""Prepare the YuNet multiscale face detector bundle (MIT, OpenCV Zoo 2026may).

Learned weights are never changed. The dynamic-shape source graph is pinned into static view graphs
and assembled into one fused graph per canvas box, so the app uploads a single uint8 frame per sample:

* yunet_fused_1536{,_landscape,_portrait}.onnx: input `image` uint8 [1, H, W, 3] RGB, the frame
  letterboxed top-left into the 1536 view box. Inside: BGR float, an exact 4x AveragePool for the
  384 view, a linear Resize by 5/8 plus a whole-box horizontal mirror for the 960 view, the 1536 view
  as is, and three YuNet copies. Outputs: twelve heads per view, prefixed `384_`, `960_`, `1536_`.
* yunet_384.onnx, yunet_960.onnx: single square views (float BGR 0..255 NCHW) for 640 px recovery tiles.
Every bundled graph computes in float16 with the original IO types (the measured app configuration).

Checks: every static graph reproduces the dynamic source, the fused 1536 branch reproduces its static
graph, and the float16 classification/objectness heads stay within 2e-3 of float32. The
clipper-vision manifest.json is rewritten with the new entries.

Requires: numpy, onnx, onnxruntime, onnxconverter-common
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from onnxconverter_common import float16

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/models/yunet/face_detection_yunet_2026may.onnx"
SOURCE_SHA256 = "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0"
BUNDLE = ROOT / "src-tauri/resources/models/clipper-vision"
MANIFEST = BUNDLE / "manifest.json"
MODEL_VERSION = "clipper-vision-v7-yolox-s-yunet-multiscale"
PREPARED_BY = "scripts/models/prepare_yunet_multiscale.py"
HEADS = ["cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32",
         "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"]
# (long side, scale from the 1536 canvas, mirrored); order matches the app's view indices.
VIEWS = ((384, 0.25, False), (960, 0.625, True), (1536, 1.0, False))
TILE_VIEWS = (384, 960)
FP16_TOLERANCE = 2e-3


def sha256(path: Path) -> str:
    """Hex SHA-256 of a file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def session(model: onnx.ModelProto) -> ort.InferenceSession:
    """CPU session over an in-memory model."""
    return ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"])


def boxes(size: int) -> dict[str, tuple[int, int]]:
    """File suffix -> (width, height) of every box of one view. Mirrors FaceView::dimensions."""
    short = -(-size * 9 // (16 * 32)) * 32
    return {"": (size, size), "_landscape": (size, short), "_portrait": (short, size)}


def static_graph(source: onnx.ModelProto, width: int, height: int) -> onnx.ModelProto:
    """Pin the dynamic 1x3xHxW input and re-infer every intermediate shape."""
    model = onnx.ModelProto()
    model.CopyFrom(source)
    dims = model.graph.input[0].type.tensor_type.shape.dim
    dims[0].dim_value = 1
    dims[2].dim_value = height
    dims[3].dim_value = width
    for output in model.graph.output:
        for dim in output.type.tensor_type.shape.dim:
            dim.ClearField("dim_param")
    del model.graph.value_info[:]
    model = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    onnx.checker.check_model(model, full_check=True)
    return model


def input_dims(model: onnx.ModelProto) -> tuple[int, int]:
    """(height, width) of an NCHW graph input."""
    dims = model.graph.input[0].type.tensor_type.shape.dim
    return dims[2].dim_value, dims[3].dim_value


def prefixed_branch(model: onnx.ModelProto, prefix: str, source: str):
    """Nodes and initializers of a static view graph with every name prefixed, fed by `source`."""
    rename = lambda name: source if name == "input" else (prefix + name if name else name)
    nodes = []
    for node in model.graph.node:
        clone = onnx.NodeProto()
        clone.CopyFrom(node)
        clone.name = prefix + node.name
        clone.input[:] = [rename(name) for name in node.input]
        clone.output[:] = [rename(name) for name in node.output]
        nodes.append(clone)
    initializers = []
    for tensor in model.graph.initializer:
        clone = onnx.TensorProto()
        clone.CopyFrom(tensor)
        clone.name = prefix + tensor.name
        initializers.append(clone)
    return nodes, initializers


def fused_graph(views: dict[int, onnx.ModelProto]) -> onnx.ModelProto:
    """One graph: uint8 NHWC canvas of the 1536 view box -> 36 head outputs of all three views."""
    canvas_h, canvas_w = input_dims(views[1536])
    nodes, initializers, outputs = [], [], []

    def constant(name, values, dtype=np.int64):
        initializers.append(numpy_helper.from_array(np.array(values, dtype), name))

    nodes.append(helper.make_node("Cast", ["image"], ["image_float"], to=TensorProto.FLOAT))
    nodes.append(helper.make_node("Transpose", ["image_float"], ["image_nchw"], perm=[0, 3, 1, 2]))
    constant("bgr_index", [2, 1, 0])
    nodes.append(helper.make_node("Gather", ["image_nchw", "bgr_index"], ["view_1536"], axis=1))
    for size, factor, mirrored in VIEWS:
        source = "view_1536"
        if size != 1536:
            height, width = input_dims(views[size])
            scaled_h, scaled_w = round(canvas_h * factor), round(canvas_w * factor)
            if size == 384:
                nodes.append(helper.make_node("AveragePool", ["view_1536"], ["scaled_384"],
                                              kernel_shape=[4, 4], strides=[4, 4]))
            else:
                constant("resize_roi", [], np.float32)
                constant("resize_scales", [], np.float32)
                constant(f"resize_sizes_{size}", [1, 3, scaled_h, scaled_w])
                nodes.append(helper.make_node(
                    "Resize", ["view_1536", "resize_roi", "resize_scales", f"resize_sizes_{size}"],
                    [f"scaled_{size}"], mode="linear", coordinate_transformation_mode="half_pixel"))
            constant(f"pads_{size}", [0, 0, 0, 0, 0, 0, height - scaled_h, width - scaled_w])
            nodes.append(helper.make_node("Pad", [f"scaled_{size}", f"pads_{size}"], [f"view_{size}"],
                                          mode="constant"))
            source = f"view_{size}"
            if mirrored:
                constant("mirror_starts", [-1])
                constant("mirror_ends", [-(2 ** 62)])
                constant("mirror_axes", [3])
                constant("mirror_steps", [-1])
                nodes.append(helper.make_node(
                    "Slice", [source, "mirror_starts", "mirror_ends", "mirror_axes", "mirror_steps"],
                    [f"mirrored_{size}"]))
                source = f"mirrored_{size}"
        branch_nodes, branch_initializers = prefixed_branch(views[size], f"v{size}_", source)
        nodes += branch_nodes
        initializers += branch_initializers
        for head in HEADS:
            nodes.append(helper.make_node("Identity", [f"v{size}_{head}"], [f"{size}_{head}"]))
            outputs.append(helper.make_tensor_value_info(f"{size}_{head}", TensorProto.FLOAT, None))
    graph = helper.make_graph(
        nodes, "yunet_multiscale_fused",
        [helper.make_tensor_value_info("image", TensorProto.UINT8, [1, canvas_h, canvas_w, 3])],
        outputs, initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 11)])
    model.ir_version = 6
    model = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    onnx.checker.check_model(model, full_check=True)
    return model


def to_fp16(model: onnx.ModelProto) -> onnx.ModelProto:
    """Float16 compute with the original IO types; a uint8 input Cast must produce float16."""
    converted = float16.convert_float_to_float16(model, keep_io_types=True)
    for node in converted.graph.node:
        if node.op_type == "Cast" and node.input[0] == "image":
            for attribute in node.attribute:
                if attribute.name == "to":
                    attribute.i = TensorProto.FLOAT16
    return converted


def head_parity(reference: list[np.ndarray], actual: list[np.ndarray], names: list[str]) -> float:
    """Largest absolute difference over classification/objectness heads."""
    return max(float(np.abs(a - b).max()) for a, b, name in zip(reference, actual, names)
               if "cls" in name or "obj" in name)


def save(model: onnx.ModelProto, name: str) -> Path:
    target = BUNDLE / name
    onnx.save(model, target)
    return target


def entry(path: Path, model: onnx.ModelProto, extra: dict) -> dict:
    tensor = model.graph.input[0]
    return {
        "onnxFile": path.name,
        "onnxSha256": sha256(path),
        "input": {"name": tensor.name,
                  "dtype": "uint8" if tensor.type.tensor_type.elem_type == TensorProto.UINT8 else "float32",
                  "shape": [d.dim_value for d in tensor.type.tensor_type.shape.dim]},
        "preparedBy": PREPARED_BY,
        "sourcePath": SOURCE.relative_to(ROOT).as_posix(),
        "sourceSha256": SOURCE_SHA256,
        **extra,
    }


def main() -> None:
    if sha256(SOURCE) != SOURCE_SHA256:
        sys.exit(f"Unexpected source checksum for {SOURCE}")
    source = onnx.load(SOURCE)
    reference = session(source)
    rng = np.random.default_rng(7)
    entries: dict[str, dict] = {}

    for size in TILE_VIEWS:
        model = static_graph(source, size, size)
        probe = rng.uniform(0, 255, (1, 3, size, size)).astype(np.float32)
        expected = reference.run(HEADS, {"input": probe})
        if head_parity(expected, session(model).run(HEADS, {"input": probe}), HEADS) > 1e-5:
            sys.exit(f"yunet_{size} static graph parity failed")
        half = to_fp16(model)
        drift = head_parity(expected, session(half).run(HEADS, {"input": probe}), HEADS)
        if drift > FP16_TOLERANCE:
            sys.exit(f"yunet_{size} fp16 drift {drift}")
        decoder = {"viewLongSide": size, "strides": [8, 16, 32], "keypointCount": 5,
                   "score": "sqrt(cls*obj)", "use": "640 px recovery tiles"}
        preprocessing = {"colorOrder": "bgr", "layout": "nchw", "normalize": "none (0..255)",
                         "resize": "bilinear-letterbox-top-left"}
        path = save(half, f"yunet_{size}.onnx")
        entries[f"yunet_{size}"] = entry(path, half, {"decoder": decoder, "preprocessing": preprocessing,
                                                       "precision": "float16",
                                                       "parity": {"maxHeadErrorVsFp32": drift}})

    for suffix in ("", "_landscape", "_portrait"):
        views = {size: static_graph(source, *boxes(size)[suffix]) for size, _, _ in VIEWS}
        fused = fused_graph(views)
        canvas_h, canvas_w = input_dims(views[1536])
        names = [o.name for o in fused.graph.output]
        canvas = rng.integers(0, 256, (1, canvas_h, canvas_w, 3), dtype=np.uint8)
        fused_out = session(fused).run(names, {"image": canvas})
        single = session(views[1536]).run(
            HEADS, {"input": canvas[..., ::-1].transpose(0, 3, 1, 2).astype(np.float32).copy()})
        branch = [fused_out[names.index(f"1536_{head}")] for head in HEADS]
        if head_parity(single, branch, HEADS) > 1e-5:
            sys.exit(f"fused{suffix}: 1536 branch differs from its static view graph")
        half = to_fp16(fused)
        drift = head_parity(fused_out, session(half).run(names, {"image": canvas}), names)
        if drift > FP16_TOLERANCE:
            sys.exit(f"fused{suffix} fp16 drift {drift}")
        stem = f"yunet_fused_1536{suffix}"
        multiscale = {
            "views": [size for size, _, _ in VIEWS],
            "mirroredViews": [size for size, _, mirrored in VIEWS if mirrored],
            "viewScoreFloor": 0.05, "suppressionIou": 0.4, "memberIou": 0.5, "agreement": 0.35,
            "scoreThreshold": 0.5,
            "calibration": "fused score mapped to the SCRFD-10G precision scale on the WIDER FACE holdout "
                           "(0.745/0.815/0.855/0.91 -> 0.5/0.6/0.7/0.8)",
        }
        preprocessing = {"colorOrder": "rgb", "layout": "nhwc", "dtype": "uint8",
                         "resize": "bilinear-letterbox-top-left (1536 view box); smaller views in graph"}
        path = save(half, f"{stem}.onnx")
        entries[stem] = entry(path, half, {"multiscale": multiscale, "preprocessing": preprocessing,
                                           "precision": "float16",
                                           "parity": {"maxHeadErrorVsFp32": drift}})

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["modelVersion"] = MODEL_VERSION
    kept = {name: value for name, value in manifest["models"].items()
            if not name.startswith("yunet_")}
    manifest["models"] = {**kept, **entries}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    for name, value in entries.items():
        print(f"{name:32} {value['onnxSha256'][:16]}  {value.get('parity', '')}")


if __name__ == "__main__":
    main()
