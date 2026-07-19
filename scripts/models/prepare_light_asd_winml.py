#!/usr/bin/env python3
"""Export the supplied Light-ASD AVA checkpoint to a WinML-compatible ONNX."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "reference-algorithms/Light-ASD"
WEIGHTS = REFERENCE / "weight/pretrain_AVA_CVPR.model"
DESTINATION = ROOT / "src-tauri/resources/models/clipper-vision/light_asd_ava.onnx"
EXPECTED_SHA256 = "d44bc3ea7baa8e0946fa3921311714a630ed8b90a1928fab0dbe30d918909317"

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
        # The reference applies MaxPool3d to a 4-D audio tensor. MaxPool2d
        # with the corresponding axes is mathematically identical and exports
        # to valid ONNX/WinML.
        self.model.audioEncoder.pool1 = nn.MaxPool2d((1, 3), (1, 2), (0, 1))
        self.model.audioEncoder.pool2 = nn.MaxPool2d((1, 3), (1, 2), (0, 1))
        self.classifier = nn.Linear(128, 2)
        model_state = {key.removeprefix("model."): value for key, value in state.items() if key.startswith("model.")}
        classifier_state = {key.removeprefix("lossAV.FC."): value for key, value in state.items() if key.startswith("lossAV.FC.")}
        self.model.load_state_dict(model_state, strict=True)
        self.classifier.load_state_dict(classifier_state, strict=True)

    def forward(self, audio_mfcc: torch.Tensor, face_gray: torch.Tensor) -> torch.Tensor:
        audio = self.model.forward_audio_frontend(audio_mfcc)
        visual = self.model.forward_visual_frontend(face_gray)
        fused = self.model.forward_audio_visual_backend(audio, visual)
        batch, time = face_gray.shape[:2]
        logits = self.classifier(fused).reshape(batch, time, 2)
        return torch.softmax(logits, dim=-1)[..., 1]


def main() -> None:
    if sha256(WEIGHTS) != EXPECTED_SHA256:
        raise RuntimeError("Unexpected Light-ASD AVA checkpoint SHA-256")
    torch.manual_seed(7)
    state = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
    model = ExportModel(state).eval()
    audio = torch.linspace(-1, 1, 2 * 200 * 13, dtype=torch.float32).reshape(2, 200, 13)
    visual = torch.linspace(0, 255, 2 * 50 * 112 * 112, dtype=torch.float32).reshape(2, 50, 112, 112)
    with torch.no_grad():
        expected = model(audio, visual).numpy()
    torch.onnx.export(
        model,
        (audio, visual),
        DESTINATION,
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
    onnx.checker.check_model(onnx.load(DESTINATION), full_check=True)
    session = ort.InferenceSession(str(DESTINATION), providers=["CPUExecutionProvider"])
    actual = session.run(None, {"audio_mfcc": audio.numpy(), "face_gray": visual.numpy()})[0]
    difference = float(np.max(np.abs(actual - expected)))
    if difference > 1e-5:
        raise RuntimeError(f"Light-ASD ONNX parity failed: {difference}")
    print(f"Wrote {DESTINATION}")
    print(f"sha256={sha256(DESTINATION)} maxAbsError={difference}")


if __name__ == "__main__":
    main()
