#!/usr/bin/env python3
"""Inspect/fix Whisper ONNX graphs: remove dangling graph outputs.

Originally written for encoder.onnx (32 declared cross-KV outs, only 0..3 real).
Also works on decoder.onnx — pass the model path explicitly.

Usage:
  python scripts/fix_encoder_outputs.py --dry-run
  python scripts/fix_encoder_outputs.py public/models/.../decoder.onnx --dry-run
  python scripts/fix_encoder_outputs.py path/to/model.onnx
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

try:
    import onnx
except ImportError:
    print("ERROR: 'onnx' package not installed. Run: pip install onnx", file=sys.stderr)
    raise SystemExit(1)


DEFAULT_ENCODER = (
    Path(__file__).resolve().parent.parent
    / "public"
    / "models"
    / "whisper-large-v3-turbo-dml"
    / "encoder.onnx"
)


def find_valid_output_names(model: onnx.ModelProto) -> set[str]:
    """Return names that can legally appear as graph outputs."""
    node_outputs: set[str] = set()
    for node in model.graph.node:
        node_outputs.update(o for o in node.output if o)
    for inp in model.graph.input:
        node_outputs.add(inp.name)
    for init in model.graph.initializer:
        node_outputs.add(init.name)
    return node_outputs


def find_unused_inputs(model: onnx.ModelProto) -> list[str]:
    """Graph inputs never consumed by any node."""
    consumed: set[str] = set()
    for node in model.graph.node:
        consumed.update(i for i in node.input if i)
    return [inp.name for inp in model.graph.input if inp.name not in consumed]


def report_kv_summary(model: onnx.ModelProto) -> None:
    prefixes = (
        "past_key_self_",
        "past_value_self_",
        "present_key_self_",
        "present_value_self_",
        "past_key_cross_",
        "past_value_cross_",
        "present_key_cross_",
        "present_value_cross_",
    )
    names = {
        "inputs": [i.name for i in model.graph.input],
        "outputs": [o.name for o in model.graph.output],
    }
    for kind, name_list in names.items():
        for prefix in prefixes:
            idxs: list[int] = []
            for n in name_list:
                if n.startswith(prefix):
                    try:
                        idxs.append(int(n[len(prefix) :]))
                    except ValueError:
                        pass
            if idxs:
                idxs.sort()
                print(f"  {kind} {prefix}: {len(idxs)} (range {idxs[0]}..{idxs[-1]})")


def fix_model(model_path: Path, *, dry_run: bool = False) -> int:
    print(f"Loading {model_path} (without external data)...")
    model = onnx.load(str(model_path), load_external_data=False)

    print("KV summary:")
    report_kv_summary(model)

    valid_names = find_valid_output_names(model)
    original_outputs = list(model.graph.output)
    dangling = [o for o in original_outputs if o.name not in valid_names]
    unused_inputs = find_unused_inputs(model)

    if unused_inputs:
        print(f"\nUnused graph inputs ({len(unused_inputs)}) — report only, not removed:")
        for name in unused_inputs:
            print(f"  - {name}")

    if not dangling:
        print("\nNo dangling outputs found — model is already valid.")
        return 0

    print(f"\nFound {len(dangling)} dangling graph outputs:")
    for o in dangling:
        print(f"  - {o.name}")

    if dry_run:
        print("\n[DRY RUN] No changes written.")
        return len(dangling)

    dangling_names = {o.name for o in dangling}
    to_keep = [o for o in original_outputs if o.name not in dangling_names]
    del model.graph.output[:]
    model.graph.output.extend(to_keep)

    print(f"\nKept {len(to_keep)} valid graph outputs:")
    for o in to_keep:
        print(f"  + {o.name}")

    backup = model_path.with_suffix(".onnx.bak")
    if not backup.exists():
        shutil.copy2(model_path, backup)
        print(f"\nBackup saved to {backup}")

    onnx.save(model, str(model_path))
    print(f"Fixed model saved to {model_path}")
    print(f"Outputs reduced: {len(original_outputs)} -> {len(to_keep)}")
    return len(dangling)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect/fix dangling graph outputs in Whisper ONNX models"
    )
    parser.add_argument(
        "model_path",
        nargs="?",
        default=None,
        help=f"Path to .onnx (default: {DEFAULT_ENCODER})",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Show what would be fixed without writing"
    )
    args = parser.parse_args()

    path = Path(args.model_path) if args.model_path else DEFAULT_ENCODER
    if not path.is_file():
        print(f"ERROR: {path} not found", file=sys.stderr)
        raise SystemExit(1)

    fix_model(path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
