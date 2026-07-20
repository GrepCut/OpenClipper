#!/usr/bin/env python3
"""Copy ONNX generalization models from public/models into the WinML bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "src-tauri/resources/models/clipper-vision/manifest.json"
BUNDLE_DIR = ROOT / "src-tauri/resources/models/clipper-vision"
PUBLIC_PREFIX = "public/models/"
SYNCABLE_SUFFIXES = {".onnx", ".pth", ".safetensors"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_onnx_source(source_path: str, onnx_file: str) -> Path:
    relative = Path(source_path)
    if relative.suffix.lower() == ".onnx":
        return ROOT / relative
    return ROOT / relative.parent / onnx_file


def sync_models(dry_run: bool) -> int:
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    models = manifest.get("models")
    if not isinstance(models, dict):
        print("clipper-vision sync: manifest.json missing models object", file=sys.stderr)
        return 1

    copied = 0
    hash_updates = 0
    missing: list[str] = []
    manifest_dirty = False

    for name, entry in models.items():
        if not isinstance(entry, dict):
            continue
        source_path = entry.get("sourcePath")
        onnx_file = entry.get("onnxFile")
        if not isinstance(source_path, str) or not source_path.startswith(PUBLIC_PREFIX):
            continue
        if Path(source_path).suffix.lower() not in SYNCABLE_SUFFIXES:
            continue
        usage = entry.get("usage")
        if not isinstance(usage, str) or not usage.startswith("shadow"):
            continue
        if not isinstance(onnx_file, str):
            print(f"clipper-vision sync: {name}: missing onnxFile", file=sys.stderr)
            return 1

        source = resolve_onnx_source(source_path, onnx_file)
        destination = BUNDLE_DIR / onnx_file
        if not source.is_file():
            missing.append(f"{name}: {source.relative_to(ROOT)}")
            continue

        actual_hash = sha256(source)
        expected_hash = entry.get("onnxSha256")
        destination_exists = destination.is_file()
        destination_hash = sha256(destination) if destination_exists else None
        needs_copy = destination_hash != actual_hash
        needs_hash_update = expected_hash != actual_hash

        if needs_copy:
            action = "copy" if not dry_run else "would copy"
            print(f"{action} {source.relative_to(ROOT)} -> {destination.relative_to(ROOT)}")
            if not dry_run:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
            copied += 1
        elif needs_hash_update:
            print(f"hash update {onnx_file}: manifest already matches source on disk")

        if needs_hash_update:
            if not dry_run:
                entry["onnxSha256"] = actual_hash
                manifest_dirty = True
            else:
                print(f"would update onnxSha256 for {name}: {expected_hash} -> {actual_hash}")
            hash_updates += 1

    if missing:
        print("clipper-vision sync: missing source ONNX:", file=sys.stderr)
        for item in missing:
            print(f"  - {item}", file=sys.stderr)
        return 1

    if manifest_dirty and not dry_run:
        MANIFEST_PATH.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    if dry_run:
        print(f"dry-run: {copied} file(s) to copy, {hash_updates} hash update(s)")
    else:
        print(f"synced: {copied} file(s) copied, {hash_updates} hash update(s)")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync public/models ONNX files into clipper-vision bundle.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show planned copies and hash updates without writing files.",
    )
    args = parser.parse_args()
    raise SystemExit(sync_models(args.dry_run))


if __name__ == "__main__":
    main()
