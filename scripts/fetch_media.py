#!/usr/bin/env python3
"""Refresh locally vendored player portraits from the audited Commons URLs."""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.request
from pathlib import Path

try:
    from .analyze import MEDIA_PATH, ROOT
except ImportError:  # pragma: no cover
    from analyze import MEDIA_PATH, ROOT


USER_AGENT = "GOAT-Index-Media-Audit/1.0 (+https://github.com/mousedoc/goat-of-football)"
JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
WEBP_MAGIC = b"RIFF"


def looks_like_image(data: bytes) -> bool:
    return data.startswith(JPEG_MAGIC) or data.startswith(PNG_MAGIC) or (
        data.startswith(WEBP_MAGIC) and data[8:12] == b"WEBP"
    )


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read()
    if len(data) < 1_024 or not looks_like_image(data):
        raise ValueError(f"download was not a valid image: {url}")
    return data


def refresh(verify_only: bool = False) -> None:
    media = json.loads(MEDIA_PATH.read_text(encoding="utf-8"))
    for entry in media["players"]:
        target = ROOT / "site" / entry["asset_path"]
        if verify_only:
            data = target.read_bytes()
            if not looks_like_image(data) or len(data) < 1_024:
                raise ValueError(f"invalid local portrait: {target}")
            print(f"verified {entry['player_id']}: {len(data):,} bytes")
            continue

        data = fetch(entry["download_url"])
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        temporary.replace(target)
        print(f"fetched {entry['player_id']}: {len(data):,} bytes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="verify committed files without network access")
    args = parser.parse_args()
    refresh(args.verify_only)


if __name__ == "__main__":
    main()
