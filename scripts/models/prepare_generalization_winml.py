#!/usr/bin/env python3
"""Export ViNet-S saliency and OSNet x0.5 checkpoints to ONNX for WinML."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from safetensors.torch import load_file

ROOT = Path(__file__).resolve().parents[2]
VINET_REFERENCE = ROOT / "reference-algorithms/video-saliency/vinet-v2/ViNet_S"
OSNET_REFERENCE = ROOT / "reference-algorithms/deep-person-reid"

VINET_WEIGHTS = ROOT / "public/models/vinet/vinet-s-saliency.safetensors"
OSNET_WEIGHTS = ROOT / (
    "public/models/osnet/"
    "osnet_x0_5_msmt17_combineall_256x128_amsgrad_ep150_stp60_lr0.0015_b64_fb10_softmax_labelsmooth_flip_jitter.pth"
)
VINET_ONNX = ROOT / "public/models/vinet/vinet-s-saliency.onnx"
OSNET_ONNX = ROOT / "public/models/osnet/osnet_x0_5_msmt17.onnx"

VINET_CLIPS = 32
VINET_HEIGHT = 224
VINET_WIDTH = 384
REID_HEIGHT = 256
REID_WIDTH = 128
OPSET = 15


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_vinet() -> torch.nn.Module:
    sys.path.insert(0, str(VINET_REFERENCE))
    from ViNet_S_model import VideoSaliencyModel  # noqa: E402

    model = VideoSaliencyModel(
        use_upsample=True,
        num_hier=3,
        num_clips=VINET_CLIPS,
        grouped_conv=True,
        root_grouping=True,
        BiCubic=False,
    )
    state = load_file(VINET_WEIGHTS)
    model.load_state_dict(state, strict=True)
    return model.eval()


def build_osnet() -> torch.nn.Module:
    import importlib.util

    module_path = OSNET_REFERENCE / "torchreid/models/osnet.py"
    spec = importlib.util.spec_from_file_location("clipper_osnet", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load OSNet module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    model = module.osnet_x0_5(num_classes=4101, loss="softmax", pretrained=False)
    state = torch.load(OSNET_WEIGHTS, map_location="cpu", weights_only=False)
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        raise RuntimeError(f"OSNet load mismatch missing={missing} unexpected={unexpected}")
    return model.eval()


def deterministic_vinet_input(batch: int = 1) -> torch.Tensor:
    count = batch * 3 * VINET_CLIPS * VINET_HEIGHT * VINET_WIDTH
    values = torch.linspace(0.0, 1.0, count, dtype=torch.float32)
    return values.reshape(batch, 3, VINET_CLIPS, VINET_HEIGHT, VINET_WIDTH)


def deterministic_osnet_input(batch: int = 1) -> torch.Tensor:
    count = batch * 3 * REID_HEIGHT * REID_WIDTH
    values = torch.linspace(0.0, 1.0, count, dtype=torch.float32)
    return values.reshape(batch, 3, REID_HEIGHT, REID_WIDTH)


def parity_check(
    session: ort.InferenceSession,
    input_name: str,
    output_name: str,
    torch_model: torch.nn.Module,
    make_input,
) -> float:
    maximum_difference = 0.0
    for batch in (1, 2):
        sample = make_input(batch)
        with torch.no_grad():
            torch_output = torch_model(sample).detach().cpu().numpy()
        onnx_output = session.run(None, {input_name: sample.numpy()})[0]
        maximum_difference = max(
            maximum_difference,
            float(np.max(np.abs(onnx_output - torch_output))),
        )
    return maximum_difference


def export_vinet(destination: Path) -> None:
    if not VINET_WEIGHTS.is_file():
        raise FileNotFoundError(VINET_WEIGHTS)
    model = build_vinet()
    sample = deterministic_vinet_input(1)
    with torch.no_grad():
        expected_shape = tuple(model(sample).shape)
    if expected_shape != (1, VINET_HEIGHT, VINET_WIDTH):
        raise RuntimeError(f"Unexpected ViNet output shape: {expected_shape}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        sample,
        destination,
        input_names=["video"],
        output_names=["saliency"],
        dynamic_axes={
            "video": {0: "batch"},
            "saliency": {0: "batch"},
        },
        opset_version=OPSET,
        do_constant_folding=True,
    )
    onnx.checker.check_model(onnx.load(destination), full_check=True)
    session = ort.InferenceSession(str(destination), providers=["CPUExecutionProvider"])
    maximum_difference = parity_check(session, "video", "saliency", model, deterministic_vinet_input)
    if maximum_difference > 1e-4:
        raise RuntimeError(f"ViNet ONNX parity failed: {maximum_difference}")
    print(f"Wrote {destination}")
    print(f"sha256={sha256(destination)} maxAbsError={maximum_difference}")


def export_osnet(destination: Path) -> None:
    if not OSNET_WEIGHTS.is_file():
        raise FileNotFoundError(OSNET_WEIGHTS)
    model = build_osnet()
    sample = deterministic_osnet_input(1)
    with torch.no_grad():
        expected_shape = tuple(model(sample).shape)
    if expected_shape != (1, 512):
        raise RuntimeError(f"Unexpected OSNet output shape: {expected_shape}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        sample,
        destination,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch"},
            "output": {0: "batch"},
        },
        opset_version=OPSET,
        do_constant_folding=True,
    )
    onnx.checker.check_model(onnx.load(destination), full_check=True)
    session = ort.InferenceSession(str(destination), providers=["CPUExecutionProvider"])
    maximum_difference = parity_check(session, "input", "output", model, deterministic_osnet_input)
    if maximum_difference > 2e-4:
        raise RuntimeError(f"OSNet ONNX parity failed: {maximum_difference}")
    print(f"Wrote {destination}")
    print(f"sha256={sha256(destination)} maxAbsError={maximum_difference}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        choices=["vinet", "osnet", "all"],
        default="all",
        help="Which checkpoint to export",
    )
    parser.add_argument("--vinet-out", type=Path, default=VINET_ONNX)
    parser.add_argument("--osnet-out", type=Path, default=OSNET_ONNX)
    args = parser.parse_args()

    if args.model in ("vinet", "all"):
        export_vinet(args.vinet_out.resolve())
    if args.model in ("osnet", "all"):
        export_osnet(args.osnet_out.resolve())


if __name__ == "__main__":
    main()
