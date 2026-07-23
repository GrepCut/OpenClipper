#!/usr/bin/env python3
"""List Rust files longer than a given line threshold and write a markdown report."""

from __future__ import annotations

import argparse
from datetime import date
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

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = REPO_ROOT / "src-tauri" / "src"
DEFAULT_OUTPUT = REPO_ROOT / "docs" / "long-rust-files-report.md"


def count_lines(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


def iter_rust_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*.rs"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        files.append(path)
    return files


def render_markdown(
    *,
    root: Path,
    min_lines: int,
    results: list[tuple[int, Path]],
    output: Path,
) -> str:
    rel_root = root.relative_to(REPO_ROOT).as_posix()
    today = date.today().isoformat()
    script_name = Path(__file__).name

    lines = [
        f"# Pliki Rust w `{rel_root}` dłuższe niż {min_lines} linii",
        "",
        f"Wygenerowano: {today}  ",
        f"Zakres: `{rel_root}/`  ",
        f"Próg: > {min_lines} linii  ",
        f"Łącznie: **{len(results)} plików**",
        "",
        "Ponowne wygenerowanie:",
        "",
        "```bash",
        f"python scripts/{script_name}",
        "```",
        "",
        "## Lista (malejąco po liczbie linii)",
        "",
        "| Linie | Plik |",
        "|------:|------|",
    ]

    for line_count, path in results:
        rel = path.relative_to(root).as_posix()
        lines.append(f"| {line_count} | `{rel}` |")

    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--min-lines", type=int, default=250)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Markdown report path (use --no-write to skip)",
    )
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="Print results only; do not write markdown",
    )
    args = parser.parse_args()

    results: list[tuple[int, Path]] = []
    for path in iter_rust_files(args.root):
        line_count = count_lines(path)
        if line_count > args.min_lines:
            results.append((line_count, path))

    results.sort(key=lambda item: item[0], reverse=True)

    print(f"Rust files over {args.min_lines} lines in {args.root}:")
    print(f"Total: {len(results)}\n")

    for line_count, path in results:
        rel = path.relative_to(args.root)
        print(f"{line_count:5d}  {rel}")

    if not args.no_write:
        markdown = render_markdown(
            root=args.root,
            min_lines=args.min_lines,
            results=results,
            output=args.output,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(markdown, encoding="utf-8")
        print(f"\nWrote {args.output.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
