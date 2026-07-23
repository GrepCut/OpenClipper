#!/usr/bin/env python3
"""List project files longer than a given line threshold."""

from __future__ import annotations

import argparse
from pathlib import Path

SKIP_DIRS = {
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "coverage",
    "__pycache__",
    ".cursor",
}

DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "src"


def count_lines(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        files.append(path)
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--min-lines", type=int, default=250)
    args = parser.parse_args()

    results: list[tuple[int, Path]] = []
    for path in iter_files(args.root):
        line_count = count_lines(path)
        if line_count > args.min_lines:
            results.append((line_count, path))

    results.sort(key=lambda item: item[0], reverse=True)

    print(f"Files over {args.min_lines} lines in {args.root}:")
    print(f"Total: {len(results)}\n")

    for line_count, path in results:
        rel = path.relative_to(args.root)
        print(f"{line_count:5d}  {rel}")


if __name__ == "__main__":
    main()
