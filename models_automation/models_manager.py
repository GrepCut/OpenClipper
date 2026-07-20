#!/usr/bin/env python3
"""Prepare a verified R2 mirror for Open Clipper model assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
AUTOMATION_DIR = Path(__file__).resolve().parent
MODEL_ROOT = ROOT / "public" / "models"
MANIFEST_PATH = AUTOMATION_DIR / "model-manifest.json"
PREPARED_PATH = AUTOMATION_DIR / "prepared_models.json"
HISTORY_PATH = AUTOMATION_DIR / "models_history.json"
MIRROR_ROOT = AUTOMATION_DIR / "r2_mirror"
ACTIVE_ROOT = MIRROR_ROOT / "v1"
ROLLBACK_ROOT = MIRROR_ROOT / "_rollback" / "previous"

# Only browser/Tauri download-on-demand assets belong in the CDN. Native
# clipper-vision models are deliberately bundled under src-tauri/resources.
MODEL_DIRECTORIES = (
    "blaze_face_full_range",
    "blaze_face_short_range",
    "magic_touch",
    "nemo-parakeet-tdt-0.6b-v3-int8",
)
EXCLUDED_PARTS = {"test_wavs"}
EXCLUDED_NAMES = {".gitkeep", "README.md"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_if_changed(path: Path, value: Any) -> None:
    content = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def collect_files() -> list[tuple[Path, str]]:
    collected: dict[str, Path] = {}
    for relative_dir in MODEL_DIRECTORIES:
        source_dir = MODEL_ROOT / relative_dir
        if not source_dir.is_dir():
            raise RuntimeError(f"Missing required model source: {source_dir}")
        for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
            relative = source.relative_to(MODEL_ROOT)
            if source.name in EXCLUDED_NAMES or EXCLUDED_PARTS.intersection(relative.parts):
                continue
            remote = f"models/{relative.as_posix()}"
            previous = collected.get(remote)
            if previous and sha256_file(previous) != sha256_file(source):
                raise RuntimeError(f"Conflicting sources for CDN path {remote}")
            collected[remote] = source
    return [(source, remote) for remote, source in sorted(collected.items())]


def build_manifest(files: list[tuple[Path, str]]) -> dict[str, Any]:
    entries = [
        {"path": remote, "size": source.stat().st_size, "sha256": sha256_file(source)}
        for source, remote in files
    ]
    return {"version": 1, "totalSize": sum(entry["size"] for entry in entries), "files": entries}


def manifest_hash(manifest: dict[str, Any]) -> str:
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def generate_manifest() -> tuple[list[tuple[Path, str]], dict[str, Any]]:
    files = collect_files()
    manifest = build_manifest(files)
    write_json_if_changed(MANIFEST_PATH, manifest)
    return files, manifest


def load_json(path: Path, description: str) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"{description} not found: run `npm run models:prepare` first.")
    return json.loads(path.read_text(encoding="utf-8"))


def command_manifest(_: argparse.Namespace) -> None:
    files, manifest = generate_manifest()
    print(f"Model manifest: {len(files)} files, {manifest['totalSize']} bytes -> {MANIFEST_PATH}")


def command_prepare(_: argparse.Namespace) -> None:
    files, manifest = generate_manifest()
    prepared = {
        "schemaVersion": 1,
        "preparedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "manifestSha256": manifest_hash(manifest),
        "fileCount": len(files),
        "totalSize": manifest["totalSize"],
    }
    write_json_if_changed(PREPARED_PATH, prepared)
    print(f"Prepared {prepared['fileCount']} model files ({prepared['totalSize']} bytes).")


def verify_prepared() -> tuple[list[tuple[Path, str]], dict[str, Any], dict[str, Any]]:
    prepared = load_json(PREPARED_PATH, "Prepared model set")
    files, manifest = generate_manifest()
    if prepared.get("manifestSha256") != manifest_hash(manifest):
        raise RuntimeError("Model sources changed after prepare; run `npm run models:prepare` again.")
    return files, manifest, prepared


def command_verify(_: argparse.Namespace) -> None:
    files, manifest, _ = verify_prepared()
    print(f"Verified {len(files)} files and SHA-256 manifest ({manifest_hash(manifest)}).")


def copy_model_set(destination: Path, files: list[tuple[Path, str]], manifest: dict[str, Any]) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for source, remote in files:
        target = destination / remote
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    write_json_if_changed(destination / "model-manifest.json", manifest)


def command_promote(_: argparse.Namespace) -> None:
    files, manifest, prepared = verify_prepared()
    next_root = MIRROR_ROOT / "v1.next"
    copy_model_set(next_root, files, manifest)
    ROLLBACK_ROOT.parent.mkdir(parents=True, exist_ok=True)
    if ROLLBACK_ROOT.exists():
        shutil.rmtree(ROLLBACK_ROOT)
    if ACTIVE_ROOT.exists():
        shutil.move(str(ACTIVE_ROOT), str(ROLLBACK_ROOT))
    shutil.move(str(next_root), str(ACTIVE_ROOT))

    history = {"schemaVersion": 1, "promotions": []}
    if HISTORY_PATH.is_file():
        history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    history.setdefault("promotions", []).append(
        {
            "promotedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "manifestSha256": prepared["manifestSha256"],
            "fileCount": len(files),
            "totalSize": manifest["totalSize"],
            "cdnBaseUrl": "https://models.openclipper.grepcut.com/v1",
        }
    )
    write_json_if_changed(HISTORY_PATH, history)
    print(f"Promoted local mirror: {ACTIVE_ROOT}")


def command_rollback(_: argparse.Namespace) -> None:
    if not ROLLBACK_ROOT.is_dir():
        raise RuntimeError("No previous local model mirror is available for rollback.")
    failed_root = MIRROR_ROOT / "_rollback" / "replaced"
    if failed_root.exists():
        shutil.rmtree(failed_root)
    if ACTIVE_ROOT.exists():
        shutil.move(str(ACTIVE_ROOT), str(failed_root))
    shutil.move(str(ROLLBACK_ROOT), str(ACTIVE_ROOT))
    print(f"Restored previous local mirror: {ACTIVE_ROOT}")


def command_status(_: argparse.Namespace) -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.is_file() else None
    print(f"Manifest: {'present' if manifest else 'missing'}")
    if manifest:
        print(f"Files: {len(manifest['files'])}; bytes: {manifest['totalSize']}")
    print(f"Active mirror: {'present' if ACTIVE_ROOT.is_dir() else 'missing'}")
    print(f"Rollback mirror: {'present' if ROLLBACK_ROOT.is_dir() else 'missing'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare an Open Clipper R2 model mirror.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name, handler, help_text in [
        ("manifest", command_manifest, "Generate the deterministic model manifest."),
        ("prepare", command_prepare, "Hash and prepare the current model set."),
        ("verify", command_verify, "Verify sources have not changed since prepare."),
        ("promote", command_promote, "Copy the verified model set into the local R2 mirror."),
        ("rollback", command_rollback, "Restore the preceding local model mirror."),
        ("status", command_status, "Show local model automation state."),
    ]:
        subparser = commands.add_parser(name, help=help_text)
        subparser.set_defaults(handler=handler)
    args = parser.parse_args()
    try:
        args.handler(args)
    except RuntimeError as error:
        print(f"models automation: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
