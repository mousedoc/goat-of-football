#!/usr/bin/env python3
"""Assemble the audited static site that GitHub Pages publishes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

try:  # Package import for tests; script import for `python scripts/build_report.py`.
    from .analyze import CANDIDATES_PATH, MEDIA_PATH, MODEL_PATH, ROOT, SOURCES_PATH, build_analysis
except ImportError:  # pragma: no cover - exercised by the CLI invocation
    from analyze import CANDIDATES_PATH, MEDIA_PATH, MODEL_PATH, ROOT, SOURCES_PATH, build_analysis


SITE_DIR = ROOT / "site"
TOKENS_PATH = ROOT / "tokens.css"
INPUTS = (
    MODEL_PATH,
    CANDIDATES_PATH,
    SOURCES_PATH,
    MEDIA_PATH,
    ROOT / "scripts" / "analyze.py",
    ROOT / "scripts" / "build_report.py",
    ROOT / "scripts" / "fetch_media.py",
    TOKENS_PATH,
    *(sorted(path for path in SITE_DIR.rglob("*") if path.is_file())),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generated_at() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if epoch:
        try:
            instant = datetime.fromtimestamp(int(epoch), tz=timezone.utc)
        except ValueError:
            instant = datetime.fromisoformat(epoch.replace("Z", "+00:00")).astimezone(timezone.utc)
    else:
        instant = datetime.now(timezone.utc)
    return instant.replace(microsecond=0).isoformat()


def safe_output_path(value: str) -> Path:
    output = (ROOT / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
    if output == ROOT or ROOT not in output.parents:
        raise ValueError(f"output must be a child of the repository: {output}")
    return output


def build(output: Path) -> Path:
    if not SITE_DIR.is_dir():
        raise FileNotFoundError(f"site source is missing: {SITE_DIR}")
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(SITE_DIR, output)
    shutil.copy2(TOKENS_PATH, output / "tokens.css")

    timestamp = generated_at()
    analysis = build_analysis(timestamp)
    data_dir = output / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / "analysis.json").open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(analysis, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    manifest = {
        "generated_at": timestamp,
        "method_version": analysis["meta"]["method_version"],
        "analysis_cutoff": analysis["meta"]["as_of"],
        "inputs": [
            {
                "path": path.relative_to(ROOT).as_posix(),
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
            }
            for path in INPUTS
        ],
        "build": {
            "runtime": "Python standard library only",
            "deterministic_seed": analysis["methodology"]["sampling"]["seed"],
            "iterations": analysis["meta"]["iterations"],
        },
    }
    with (data_dir / "manifest.json").open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    (output / ".nojekyll").touch()
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="dist", help="repository-relative output directory")
    args = parser.parse_args()
    output = build(safe_output_path(args.output))
    print(f"Built report at {output}")


if __name__ == "__main__":
    main()
