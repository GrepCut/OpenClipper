#!/usr/bin/env python3
"""
Prepare and verify local desktop release artifacts for Cloudflare R2.

The hardened flow is:
1. prepare      -> choose/sync a release version before build
2. tauri build  -> produce installers and signatures
3. verify-build -> confirm manifests and artifacts match the prepared version
4. promote      -> copy verified artifacts into the local R2 mirror
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
TAURI_CONF = REPO_ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = REPO_ROOT / "src-tauri" / "Cargo.toml"
CARGO_LOCK = REPO_ROOT / "src-tauri" / "Cargo.lock"
PACKAGE_JSON = REPO_ROOT / "package.json"
PACKAGE_LOCK = REPO_ROOT / "package-lock.json"
BUNDLE_DIR = REPO_ROOT / "src-tauri" / "target" / "release" / "bundle"
HISTORY_PATH = SCRIPT_DIR / "release_history.json"
PREPARED_RELEASE_PATH = SCRIPT_DIR / "prepared_release.json"
MIRROR_ROOT = SCRIPT_DIR / "r2_mirror"
ROLLBACK_ROOT = SCRIPT_DIR / "_rolled_back"

PRODUCT_NAME = "Open Clipper"
DEFAULT_BASE_URL = "https://updates.grepcut.com/open-clipper"
PLATFORM_KEY = "windows-x86_64"
PLATFORM_DIR = Path("windows") / "x86_64"
DEFAULT_CHANNEL = "stable"
WINDOWS_BUNDLE_MAX_MAJOR_MINOR = 255
WINDOWS_BUNDLE_MAX_PATCH = 65535

VERSION_RE = re.compile(r"^(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)$")
EXE_PATTERN = re.compile(
    rf"^{re.escape(PRODUCT_NAME)}_(?P<version>\d+\.\d+\.\d+)_x64-setup\.exe$"
)


@dataclass(frozen=True)
class BuiltArtifacts:
    version: str
    exe: Path
    exe_sig: Path
    msi: Path | None
    msi_sig: Path | None


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def ensure_inside(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        fail(f"Refusing to operate outside {root_resolved}: {resolved}")
    return resolved


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"Invalid JSON in {path}: {error}")


def atomic_write_json(path: Path, data: dict[str, Any], *, root: Path) -> None:
    ensure_inside(path, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(payload)
        tmp_path = Path(handle.name)
    tmp_path.replace(path)


def atomic_write_text(path: Path, payload: str, *, root: Path) -> None:
    ensure_inside(path, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=path.parent, delete=False) as handle:
        handle.write(payload)
        tmp_path = Path(handle.name)
    tmp_path.replace(path)


def validate_semver(version: str) -> re.Match[str]:
    match = VERSION_RE.fullmatch(version)
    if not match:
        fail(f"Version must use X.Y.Z format: {version}")
    return match


def parse_semver(version: str) -> tuple[int, int, int]:
    match = validate_semver(version)
    return int(match.group("major")), int(match.group("minor")), int(match.group("patch"))


def validate_windows_bundle_version(version: str) -> tuple[int, int, int]:
    major, minor, patch = parse_semver(version)
    if major > WINDOWS_BUNDLE_MAX_MAJOR_MINOR:
        fail(
            f"Version {version} is not valid for Windows MSI bundling: major must be <= {WINDOWS_BUNDLE_MAX_MAJOR_MINOR}"
        )
    if minor > WINDOWS_BUNDLE_MAX_MAJOR_MINOR:
        fail(
            f"Version {version} is not valid for Windows MSI bundling: minor must be <= {WINDOWS_BUNDLE_MAX_MAJOR_MINOR}"
        )
    if patch > WINDOWS_BUNDLE_MAX_PATCH:
        fail(
            f"Version {version} is not valid for Windows MSI bundling: patch must be <= {WINDOWS_BUNDLE_MAX_PATCH}"
        )
    return major, minor, patch


def replace_package_field(text: str, field: str, value: str, path: Path) -> str:
    package_match = re.search(r"(?ms)^\[package\]\s*(.*?)(?=^\[|\Z)", text)
    if not package_match:
        fail(f"Missing [package] section in {path}")

    section = package_match.group(0)
    pattern = rf'(?m)^({re.escape(field)}\s*=\s*)".*"$'
    updated_section, count = re.subn(pattern, rf'\1"{value}"', section, count=1)
    if count != 1:
        fail(f"Missing {field} in [package] section of {path}")

    return text[: package_match.start()] + updated_section + text[package_match.end() :]


def load_cargo_package_name() -> str:
    if not CARGO_TOML.exists():
        fail(f"Missing Cargo manifest: {CARGO_TOML}")

    text = CARGO_TOML.read_text(encoding="utf-8")
    package_match = re.search(r"(?ms)^\[package\]\s*(.*?)(?=^\[|\Z)", text)
    if not package_match:
        fail(f"Missing [package] section in {CARGO_TOML}")

    name_match = re.search(r'(?m)^name\s*=\s*"([^"]+)"\s*$', package_match.group(0))
    if not name_match:
        fail(f"Missing package name in {CARGO_TOML}")

    return name_match.group(1)


def sync_cargo_lock_version(version: str, package_name: str) -> None:
    if not CARGO_LOCK.exists():
        return

    text = CARGO_LOCK.read_text(encoding="utf-8")
    package_pattern = re.compile(r"(?ms)^\[\[package\]\]\s*(.*?)(?=^\[\[package\]\]|\Z)")
    found_package = False

    def replace_if_app_package(match: re.Match[str]) -> str:
        nonlocal found_package
        package_block = match.group(0)
        name_match = re.search(r'(?m)^name\s*=\s*"([^"]+)"\s*$', package_block)
        if not name_match or name_match.group(1) != package_name:
            return package_block
        found_package = True
        updated_block, count = re.subn(
            r'(?m)^(version\s*=\s*)".*"$',
            rf'\1"{version}"',
            package_block,
            count=1,
        )
        if count != 1:
            fail(f"Missing version for package {package_name} in {CARGO_LOCK}")
        return updated_block

    updated_text, count = package_pattern.subn(replace_if_app_package, text)
    if count == 0:
        fail(f"No package entries found in {CARGO_LOCK}")
    if not found_package:
        fail(f"Missing package {package_name} in {CARGO_LOCK}")

    atomic_write_text(CARGO_LOCK, updated_text, root=REPO_ROOT)


def read_tauri_conf() -> dict[str, Any]:
    if not TAURI_CONF.exists():
        fail(f"Missing Tauri config: {TAURI_CONF}")
    return read_json(TAURI_CONF, {})


def load_manifest_versions() -> dict[str, str]:
    paths = [TAURI_CONF, PACKAGE_JSON, PACKAGE_LOCK, CARGO_TOML]
    missing = [path for path in paths if not path.exists()]
    if missing:
        fail("Missing version manifest(s): " + ", ".join(str(path) for path in missing))

    tauri_conf = read_tauri_conf()
    package_json = read_json(PACKAGE_JSON, {})
    package_lock = read_json(PACKAGE_LOCK, {})
    cargo_toml = CARGO_TOML.read_text(encoding="utf-8")

    cargo_package = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', cargo_toml)
    if not cargo_package:
        fail(f"Missing Cargo version in {CARGO_TOML}")

    lock_root_version = package_lock.get("version")
    lock_packages = package_lock.get("packages")
    lock_workspace_version = None
    if isinstance(lock_packages, dict) and isinstance(lock_packages.get(""), dict):
        lock_workspace_version = lock_packages[""].get("version")

    versions = {
        "tauri.conf.json": str(tauri_conf.get("version", "")),
        "package.json": str(package_json.get("version", "")),
        "package-lock.json": str(lock_root_version or ""),
        "package-lock.json#/packages/''": str(lock_workspace_version or ""),
        "Cargo.toml": cargo_package.group(1),
    }

    for source, version in versions.items():
        validate_semver(version)

    return versions


def get_product_metadata() -> tuple[str, str]:
    tauri_conf = read_tauri_conf()
    product_name = str(tauri_conf.get("productName") or PRODUCT_NAME)
    identifier = str(tauri_conf.get("identifier") or "")
    if not identifier:
        fail(f"Missing identifier in {TAURI_CONF}")
    return product_name, identifier


def assert_manifest_versions(expected_version: str | None = None) -> str:
    versions = load_manifest_versions()
    unique_versions = sorted(set(versions.values()))
    if len(unique_versions) != 1:
        details = ", ".join(f"{source}={version}" for source, version in versions.items())
        fail(f"Version mismatch across manifests: {details}")

    manifest_version = unique_versions[0]
    if expected_version and manifest_version != expected_version:
        fail(
            f"Manifest version {manifest_version} does not match expected version {expected_version}"
        )
    return manifest_version


def sync_project_versions(version: str, *, dry_run: bool = False) -> None:
    validate_windows_bundle_version(version)
    if dry_run:
        print(f"Would sync project manifest versions to {version}")
        return

    tauri_conf = read_tauri_conf()
    tauri_conf["version"] = version
    atomic_write_json(TAURI_CONF, tauri_conf, root=REPO_ROOT)

    package_json = read_json(PACKAGE_JSON, {})
    package_json["version"] = version
    atomic_write_json(PACKAGE_JSON, package_json, root=REPO_ROOT)

    package_lock = read_json(PACKAGE_LOCK, {})
    package_lock["version"] = version
    packages = package_lock.get("packages")
    if isinstance(packages, dict) and isinstance(packages.get(""), dict):
        packages[""]["version"] = version
    atomic_write_json(PACKAGE_LOCK, package_lock, root=REPO_ROOT)

    cargo_package_name = load_cargo_package_name()
    cargo_toml = CARGO_TOML.read_text(encoding="utf-8")
    updated_cargo_toml = replace_package_field(cargo_toml, "version", version, CARGO_TOML)
    atomic_write_text(CARGO_TOML, updated_cargo_toml, root=REPO_ROOT)
    sync_cargo_lock_version(version, cargo_package_name)

    print(f"Synced project manifest versions to {version}")


def load_history() -> dict[str, Any]:
    history = read_json(
        HISTORY_PATH,
        {"schemaVersion": 1, "active": {}, "releases": [], "rollbacks": []},
    )
    history.setdefault("schemaVersion", 1)
    history.setdefault("active", {})
    history.setdefault("releases", [])
    history.setdefault("rollbacks", [])
    return history


def load_prepared_release() -> dict[str, Any]:
    prepared = read_json(PREPARED_RELEASE_PATH, {})
    if not prepared:
        return {}
    version = prepared.get("version")
    if isinstance(version, str):
        validate_semver(version)
    else:
        fail(f"Missing version in {PREPARED_RELEASE_PATH}")
    prepared.setdefault("schemaVersion", 1)
    prepared.setdefault("channel", DEFAULT_CHANNEL)
    return prepared


def write_prepared_release(version: str, *, channel: str = DEFAULT_CHANNEL) -> None:
    payload = {
        "schemaVersion": 1,
        "version": version,
        "channel": channel,
        "preparedAt": utc_now(),
    }
    atomic_write_json(PREPARED_RELEASE_PATH, payload, root=SCRIPT_DIR)


def installer_exe_name(version: str, product_name: str = PRODUCT_NAME) -> str:
    return f"{product_name}_{version}_x64-setup.exe"


def installer_msi_name(version: str, product_name: str = PRODUCT_NAME) -> str:
    return f"{product_name}_{version}_x64_en-US.msi"


def iter_known_versions() -> set[str]:
    versions: set[str] = set()

    try:
        versions.update(load_manifest_versions().values())
    except SystemExit:
        pass

    prepared = load_prepared_release()
    if prepared.get("version"):
        versions.add(str(prepared["version"]))

    history = load_history()
    for record in history.get("releases", []):
        version = record.get("version")
        if isinstance(version, str):
            validate_semver(version)
            versions.add(version)
    for version in history.get("active", {}).values():
        if isinstance(version, str):
            validate_semver(version)
            versions.add(version)

    if MIRROR_ROOT.exists():
        for path in (MIRROR_ROOT / PLATFORM_DIR / "releases").glob("*"):
            if path.is_dir():
                validate_semver(path.name)
                versions.add(path.name)

    if BUNDLE_DIR.exists():
        for exe in BUNDLE_DIR.glob(f"**/{PRODUCT_NAME}_*_x64-setup.exe"):
            match = EXE_PATTERN.match(exe.name)
            if match:
                versions.add(match.group("version"))

    return versions


def compute_next_calendar_version() -> str:
    now = datetime.now().astimezone()
    year = now.year % 100
    month = now.month
    used_build_numbers: list[int] = []
    for version in iter_known_versions():
        major, minor, patch = parse_semver(version)
        if major == year and minor == month:
            used_build_numbers.append(patch)
    next_build = max(used_build_numbers, default=0) + 1
    return f"{year}.{month}.{next_build}"


def resolve_prepare_version(explicit_version: str | None) -> tuple[str, bool]:
    if explicit_version:
        version = explicit_version
        validate_windows_bundle_version(version)
        return version, False

    prepared = load_prepared_release()
    prepared_version = prepared.get("version")
    active_version = load_history().get("active", {}).get(PLATFORM_KEY)

    if isinstance(prepared_version, str):
        validate_windows_bundle_version(prepared_version)
        try:
            manifest_version = assert_manifest_versions()
        except SystemExit:
            manifest_version = None

        if manifest_version == prepared_version and prepared_version != active_version:
            return prepared_version, True

    return compute_next_calendar_version(), False


def resolve_expected_version(explicit_version: str | None = None) -> str:
    if explicit_version:
        validate_windows_bundle_version(explicit_version)
        return explicit_version

    prepared = load_prepared_release()
    version = prepared.get("version")
    if isinstance(version, str):
        return version

    fail("No prepared release found. Use `python release_automation\\release_manager.py prepare` first.")


def get_manifest_version_summary() -> str:
    versions = load_manifest_versions()
    unique_versions = sorted(set(versions.values()))
    if len(unique_versions) == 1:
        return unique_versions[0]
    return ", ".join(f"{source}={version}" for source, version in versions.items())


def release_dir(version: str) -> Path:
    return MIRROR_ROOT / PLATFORM_DIR / "releases" / version


def latest_path() -> Path:
    return MIRROR_ROOT / PLATFORM_DIR / "latest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_info(path: Path) -> dict[str, Any]:
    return {
        "name": path.name,
        "size": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def find_built_artifacts(version: str | None = None) -> BuiltArtifacts:
    nsis_dir = BUNDLE_DIR / "nsis"
    msi_dir = BUNDLE_DIR / "msi"
    if not nsis_dir.exists():
        fail(f"NSIS bundle directory not found: {nsis_dir}. Run npm run tauri:build first.")

    candidates: list[tuple[str, Path]] = []
    for exe in nsis_dir.glob(f"{PRODUCT_NAME}_*_x64-setup.exe"):
        match = EXE_PATTERN.match(exe.name)
        if not match:
            continue
        artifact_version = match.group("version")
        if version and artifact_version != version:
            continue
        candidates.append((artifact_version, exe))

    if not candidates:
        wanted = f" for version {version}" if version else ""
        fail(f"No {PRODUCT_NAME} NSIS .exe artifacts found{wanted} in {nsis_dir}")

    candidates.sort(key=lambda item: item[1].stat().st_mtime, reverse=True)
    selected_version, exe = candidates[0]
    exe_sig = exe.with_suffix(exe.suffix + ".sig")
    if not exe_sig.exists():
        fail(f"Missing updater signature for {exe.name}: {exe_sig}")

    msi = None
    msi_sig = None
    if msi_dir.exists():
        expected_msi = msi_dir / installer_msi_name(selected_version)
        expected_sig = expected_msi.with_suffix(expected_msi.suffix + ".sig")
        if expected_msi.exists():
            msi = expected_msi
            if expected_sig.exists():
                msi_sig = expected_sig
            else:
                fail(f"Missing MSI signature for {expected_msi.name}: {expected_sig}")

    return BuiltArtifacts(
        version=selected_version,
        exe=exe,
        exe_sig=exe_sig,
        msi=msi,
        msi_sig=msi_sig,
    )


def normalize_base_url(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if not base.startswith(("https://", "http://")):
        fail("--base-url must start with https:// or http://")
    return base


def build_latest_manifest(
    *,
    version: str,
    signature: str,
    base_url: str,
    notes: str,
    pub_date: str,
) -> dict[str, Any]:
    filename = installer_exe_name(version)
    encoded_filename = quote(filename)
    url = f"{base_url}/windows/x86_64/releases/{version}/{encoded_filename}"
    return {
        "version": version,
        "notes": notes,
        "pub_date": pub_date,
        "platforms": {
            PLATFORM_KEY: {
                "signature": signature,
                "url": url,
            },
        },
    }


def verify_build_version(expected_version: str) -> BuiltArtifacts:
    manifest_version = assert_manifest_versions(expected_version)
    artifacts = find_built_artifacts(expected_version)
    if artifacts.version != manifest_version:
        fail(
            f"Built artifact version {artifacts.version} does not match manifest version {manifest_version}"
        )
    return artifacts


def copy_artifact(source: Path, destination: Path) -> None:
    ensure_inside(destination, SCRIPT_DIR)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def prepare(args: argparse.Namespace) -> None:
    version, reused_prepared = resolve_prepare_version(args.version)
    validate_windows_bundle_version(version)

    if not reused_prepared and not args.force:
        for existing in iter_known_versions():
            if existing == version:
                fail(
                    f"Version {version} already exists in the local release state. "
                    "Use --force to reuse it explicitly."
                )

    if args.dry_run:
        if reused_prepared:
            print(f"Would reuse prepared desktop release version {version}")
        else:
            print(f"Would prepare desktop release version {version}")
            sync_project_versions(version, dry_run=True)
        return

    if reused_prepared:
        print(f"Reusing prepared desktop release {version}")
        print(f"Prepared metadata: {PREPARED_RELEASE_PATH}")
        return

    sync_project_versions(version)
    write_prepared_release(version)
    print(f"Prepared desktop release {version}")
    print(f"Prepared metadata: {PREPARED_RELEASE_PATH}")


def verify_build(args: argparse.Namespace) -> None:
    expected_version = resolve_expected_version(args.version)
    artifacts = verify_build_version(expected_version)
    print(f"Verified build for {expected_version}")
    print(f"Installer: {artifacts.exe}")
    if artifacts.msi:
        print(f"MSI: {artifacts.msi}")


def verify_runtime(args: argparse.Namespace) -> None:
    expected_version = resolve_expected_version(args.expected_version)
    app_version = args.app_version
    invoke_version = args.invoke_version

    if not app_version or not invoke_version:
        fail("verify-runtime requires --app-version and --invoke-version.")

    validate_semver(app_version)
    validate_semver(invoke_version)

    if app_version != expected_version:
        fail(
            f"app.getVersion() returned {app_version}, expected prepared version {expected_version}"
        )
    if invoke_version != expected_version:
        fail(
            f'invoke("get_app_version") returned {invoke_version}, expected prepared version {expected_version}'
        )

    if args.app_name:
        product_name, _ = get_product_metadata()
        if args.app_name != product_name:
            fail(f"app.getName() returned {args.app_name}, expected {product_name}")

    print(f"Runtime version check passed for {expected_version}")


def promote(args: argparse.Namespace) -> None:
    base_url = normalize_base_url(args.base_url)
    expected_version = resolve_expected_version(args.version)
    artifacts = verify_build_version(expected_version)

    target_dir = release_dir(expected_version)
    ensure_inside(target_dir, SCRIPT_DIR)
    if target_dir.exists() and not args.force:
        fail(f"Release already exists locally: {target_dir}. Use --force to replace it.")

    if args.dry_run:
        print(f"Would promote version {expected_version} into {target_dir}")
        print(f"Would update {latest_path()}")
        return

    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    exe_name = installer_exe_name(expected_version)
    exe_sig_name = f"{exe_name}.sig"
    copy_artifact(artifacts.exe, target_dir / exe_name)
    copy_artifact(artifacts.exe_sig, target_dir / exe_sig_name)

    copied_files = [target_dir / exe_name, target_dir / exe_sig_name]
    if artifacts.msi:
        msi_name = installer_msi_name(expected_version)
        copy_artifact(artifacts.msi, target_dir / msi_name)
        copied_files.append(target_dir / msi_name)
        if artifacts.msi_sig:
            copy_artifact(artifacts.msi_sig, target_dir / f"{msi_name}.sig")
            copied_files.append(target_dir / f"{msi_name}.sig")

    signature = (target_dir / exe_sig_name).read_text(encoding="utf-8").strip()
    if not signature:
        fail(f"Signature file is empty: {target_dir / exe_sig_name}")

    checksums = {
        "version": expected_version,
        "generatedAt": utc_now(),
        "files": [file_info(path) for path in copied_files],
    }
    atomic_write_json(target_dir / "checksums.json", checksums, root=SCRIPT_DIR)

    pub_date = args.pub_date or utc_now()
    latest = build_latest_manifest(
        version=expected_version,
        signature=signature,
        base_url=base_url,
        notes=args.notes,
        pub_date=pub_date,
    )
    atomic_write_json(latest_path(), latest, root=SCRIPT_DIR)

    history = load_history()
    previous_active = history.get("active", {}).get(PLATFORM_KEY)
    release_record = {
        "version": expected_version,
        "platform": PLATFORM_KEY,
        "promotedAt": utc_now(),
        "pubDate": pub_date,
        "baseUrl": base_url,
        "notes": args.notes,
        "previousActiveVersion": previous_active,
        "manifestPath": str(latest_path().relative_to(SCRIPT_DIR)).replace("\\", "/"),
        "releasePath": str(target_dir.relative_to(SCRIPT_DIR)).replace("\\", "/"),
        "files": checksums["files"],
    }
    history["releases"].append(release_record)
    history["active"][PLATFORM_KEY] = expected_version
    atomic_write_json(HISTORY_PATH, history, root=SCRIPT_DIR)

    print(f"Promoted {expected_version}")
    print(f"Mirror: {target_dir}")
    print(f"Latest manifest: {latest_path()}")


def rollback(args: argparse.Namespace) -> None:
    history = load_history()
    releases = history.get("releases", [])
    active_version = history.get("active", {}).get(PLATFORM_KEY)

    if not active_version:
        fail(f"No active release for {PLATFORM_KEY} in {HISTORY_PATH}")

    active_index = None
    for index in range(len(releases) - 1, -1, -1):
        if releases[index].get("platform") == PLATFORM_KEY and releases[index].get("version") == active_version:
            active_index = index
            break

    if active_index is None:
        fail(f"Active version {active_version} is not present in release history.")

    active_record = releases.pop(active_index)
    previous_version = active_record.get("previousActiveVersion")
    active_dir = release_dir(active_version)

    if args.dry_run:
        print(f"Would roll back {PLATFORM_KEY} from {active_version} to {previous_version or 'none'}")
        print(f"Would move {active_dir} into {ROLLBACK_ROOT}")
        if previous_version:
            sync_project_versions(previous_version, dry_run=True)
        else:
            print("Would leave manifest versions unchanged because there is no previous active version.")
        return

    rollback_stamp = utc_now().replace(":", "").replace("-", "")
    if active_dir.exists():
        rollback_target = ROLLBACK_ROOT / f"{rollback_stamp}_{active_version}"
        ensure_inside(rollback_target, SCRIPT_DIR)
        rollback_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(active_dir), str(rollback_target))
    else:
        rollback_target = None

    if previous_version:
        previous_dir = release_dir(previous_version)
        previous_sig = previous_dir / f"{installer_exe_name(previous_version)}.sig"
        if not previous_dir.exists() or not previous_sig.exists():
            fail(f"Previous release files are missing, cannot restore latest.json: {previous_dir}")

        signature = previous_sig.read_text(encoding="utf-8").strip()
        previous_record = next(
            (
                record
                for record in reversed(releases)
                if record.get("platform") == PLATFORM_KEY and record.get("version") == previous_version
            ),
            {},
        )
        latest = build_latest_manifest(
            version=previous_version,
            signature=signature,
            base_url=previous_record.get("baseUrl", args.base_url),
            notes=previous_record.get("notes", "Rollback release"),
            pub_date=previous_record.get("pubDate", utc_now()),
        )
        atomic_write_json(latest_path(), latest, root=SCRIPT_DIR)
        history["active"][PLATFORM_KEY] = previous_version
        sync_project_versions(previous_version)
        write_prepared_release(previous_version)
    else:
        latest = latest_path()
        if latest.exists():
            latest.unlink()
        history["active"].pop(PLATFORM_KEY, None)
        if PREPARED_RELEASE_PATH.exists():
            PREPARED_RELEASE_PATH.unlink()
        print("Prepared release metadata removed because there is no previous active version.")

    history["rollbacks"].append(
        {
            "rolledBackAt": utc_now(),
            "platform": PLATFORM_KEY,
            "fromVersion": active_version,
            "toVersion": previous_version,
            "archivedPath": (
                str(rollback_target.relative_to(SCRIPT_DIR)).replace("\\", "/")
                if rollback_target
                else None
            ),
        }
    )
    history["releases"] = releases
    atomic_write_json(HISTORY_PATH, history, root=SCRIPT_DIR)

    print(f"Rolled back {active_version} -> {previous_version or 'none'}")


def status(_: argparse.Namespace) -> None:
    history = load_history()
    prepared = load_prepared_release() if PREPARED_RELEASE_PATH.exists() else {}
    print(f"History: {HISTORY_PATH}")
    print(f"Mirror:  {MIRROR_ROOT}")
    print(f"Prepared: {prepared.get('version', 'none')}")

    manifest_summary = get_manifest_version_summary()
    print(f"Manifests: {manifest_summary}")
    print(f"Active {PLATFORM_KEY}: {history.get('active', {}).get(PLATFORM_KEY, 'none')}")
    print("")
    print("Recent releases:")
    for record in history.get("releases", [])[-8:]:
        print(
            f"- {record.get('version')} "
            f"at {record.get('promotedAt')} "
            f"({record.get('releasePath')})"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare local R2 release mirror for Open Clipper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser(
        "prepare",
        help="Pick the next desktop release version and sync all manifests before build.",
    )
    prepare_parser.add_argument("--version", help="Override the auto-generated YY.M.BUILD version.")
    prepare_parser.add_argument("--force", action="store_true", help="Allow reusing an existing version.")
    prepare_parser.add_argument("--dry-run", action="store_true", help="Show actions without changing files.")
    prepare_parser.set_defaults(func=prepare)

    verify_build_parser = subparsers.add_parser(
        "verify-build",
        help="Verify that built artifacts match the prepared release version.",
    )
    verify_build_parser.add_argument("--version", help="Explicit version to verify instead of prepared_release.json.")
    verify_build_parser.set_defaults(func=verify_build)

    verify_runtime_parser = subparsers.add_parser(
        "verify-runtime",
        help="Confirm runtime-reported desktop version matches the prepared release version.",
    )
    verify_runtime_parser.add_argument("--expected-version", help="Explicit expected version.")
    verify_runtime_parser.add_argument("--app-version", help="Value returned by app.getVersion().")
    verify_runtime_parser.add_argument("--invoke-version", help='Value returned by invoke("get_app_version").')
    verify_runtime_parser.add_argument("--app-name", help="Optional value returned by app.getName().")
    verify_runtime_parser.set_defaults(func=verify_runtime)

    promote_parser = subparsers.add_parser(
        "promote",
        help="Promote the verified build artifacts into r2_mirror.",
    )
    promote_parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Public URL where r2_mirror root will be served.",
    )
    promote_parser.add_argument("--version", help="Specific prepared version to promote.")
    promote_parser.add_argument(
        "--notes",
        default="Open Clipper desktop release",
        help="Release notes for latest.json.",
    )
    promote_parser.add_argument("--pub-date", help="ISO timestamp for latest.json. Defaults to now.")
    promote_parser.add_argument("--force", action="store_true", help="Replace an existing local release directory.")
    promote_parser.add_argument("--dry-run", action="store_true", help="Show actions without changing files.")
    promote_parser.set_defaults(func=promote)

    rollback_parser = subparsers.add_parser("rollback", help="Undo the current active local promotion.")
    rollback_parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Fallback base URL if the previous release record has no baseUrl.",
    )
    rollback_parser.add_argument("--dry-run", action="store_true", help="Show actions without changing files.")
    rollback_parser.set_defaults(func=rollback)

    status_parser = subparsers.add_parser("status", help="Show local release state.")
    status_parser.set_defaults(func=status)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
