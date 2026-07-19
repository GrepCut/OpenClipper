#!/usr/bin/env python3
"""Deterministically export LR-ASD AVA/TalkSet checkpoints for ONNX/WinML."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "reference-algorithms/active-speaker/lr-asd"
VARIANTS = {
    "ava": (
        REFERENCE / "weight/pretrain_AVA.model",
        "85e6c77fc981595234790d1e128ebb60352d37726b2445e0ef8891e2512fe9e3",
        ROOT / "src-tauri/resources/models/clipper-vision/lr_asd_ava.onnx",
    ),
    "talkset": (
        REFERENCE / "weight/finetuning_TalkSet.model",
        "6b4ef53694e874e96cf630198dc479c78aebb3993bbf166aee3d926dfe7d9342",
        ROOT / "src-tauri/resources/models/clipper-vision/lr_asd_talkset.onnx",
    ),
}

sys.path.insert(0, str(REFERENCE))
from model.Model import ASD_Model  # noqa: E402


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ExportModel(nn.Module):
    def __init__(self, state: dict[str, torch.Tensor]):
        super().__init__()
        self.model = ASD_Model()
        # Reference audio pooling uses MaxPool3d on a four-dimensional tensor.
        # The equivalent 2-D operation exports cleanly and is numerically equal.
        self.model.audioEncoder.pool1 = nn.MaxPool2d((1, 3), (1, 2), (0, 1))
        self.model.audioEncoder.pool2 = nn.MaxPool2d((1, 3), (1, 2), (0, 1))
        self.classifier = nn.Linear(128, 2)
        model_state = {
            key.removeprefix("model."): value
            for key, value in state.items()
            if key.startswith("model.")
        }
        classifier_state = {
            key.removeprefix("lossAV.FC."): value
            for key, value in state.items()
            if key.startswith("lossAV.FC.")
        }
        self.model.load_state_dict(model_state, strict=True)
        self.classifier.load_state_dict(classifier_state, strict=True)

    def forward(self, audio_mfcc: torch.Tensor, face_gray: torch.Tensor) -> torch.Tensor:
        audio = self.model.forward_audio_frontend(audio_mfcc)
        visual = self.model.forward_visual_frontend(face_gray)
        fused = self.model.forward_audio_visual_backend(audio, visual)
        batch, time = face_gray.shape[:2]
        logits = self.classifier(fused).reshape(batch, time, 2)
        return torch.softmax(logits, dim=-1)[..., 1]


def deterministic_inputs(seconds: int) -> tuple[torch.Tensor, torch.Tensor]:
    frames = seconds * 25
    audio = torch.linspace(-1, 1, 4 * frames * 13, dtype=torch.float32).reshape(1, 4 * frames, 13)
    visual = torch.linspace(0, 255, frames * 112 * 112, dtype=torch.float32).reshape(1, frames, 112, 112)
    return audio, visual


def export(variant: str) -> None:
    weights, expected_hash, destination = VARIANTS[variant]
    if sha256(weights) != expected_hash:
        raise RuntimeError(f"Unexpected LR-ASD {variant} checkpoint SHA-256")
    torch.manual_seed(7)
    state = torch.load(weights, map_location="cpu", weights_only=False)
    model = ExportModel(state).eval()
    audio, visual = deterministic_inputs(2)
    with torch.no_grad():
        expected = model(audio, visual).numpy()
    torch.onnx.export(
        model,
        (audio, visual),
        destination,
        input_names=["audio_mfcc", "face_gray"],
        output_names=["speaker_probability"],
        dynamic_axes={
            "audio_mfcc": {0: "batch", 1: "audio_time"},
            "face_gray": {0: "batch", 1: "time"},
            "speaker_probability": {0: "batch", 1: "time"},
        },
        opset_version=15,
        do_constant_folding=True,
    )
    onnx.checker.check_model(onnx.load(destination), full_check=True)
    session = ort.InferenceSession(str(destination), providers=["CPUExecutionProvider"])
    maximum_difference = 0.0
    for seconds in range(1, 7):
        window_audio, window_visual = deterministic_inputs(seconds)
        with torch.no_grad():
            torch_output = model(window_audio, window_visual).numpy()
        onnx_output = session.run(None, {
            "audio_mfcc": window_audio.numpy(),
            "face_gray": window_visual.numpy(),
        })[0]
        maximum_difference = max(maximum_difference, float(np.max(np.abs(onnx_output - torch_output))))
    if maximum_difference > 1e-5:
        raise RuntimeError(f"LR-ASD {variant} ONNX parity failed: {maximum_difference}")
    print(f"Wrote {destination}")
    print(f"sha256={sha256(destination)} maxAbsError={maximum_difference}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", choices=["ava", "talkset", "all"], default="ava")
    args = parser.parse_args()
    variants = VARIANTS if args.variant == "all" else [args.variant]
    for variant in variants:
        export(variant)


if __name__ == "__main__":
    main()
