#!/usr/bin/env python3
"""Fail CI when the generated report is incomplete, inconsistent, or Pages-unsafe."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse


REQUIRED_FILES = (
    "index.html",
    "404.html",
    "styles.css",
    "app.js",
    ".nojekyll",
    "data/analysis.json",
    "data/manifest.json",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate(output: Path) -> None:
    output = output.resolve()
    for relative in REQUIRED_FILES:
        require((output / relative).is_file(), f"missing required file: {relative}")

    index = (output / "index.html").read_text(encoding="utf-8")
    styles = (output / "styles.css").read_text(encoding="utf-8")
    require('lang="ko"' in index or "lang='ko'" in index, "index.html must declare Korean language")
    require("name=\"viewport\"" in index or "name='viewport'" in index, "viewport meta is required")
    require("<title>" in index, "document title is required")
    require("skip" in index.lower(), "a keyboard skip link is required")
    require(not re.search(r"(?:src|href)=[\"']/", index), "root-absolute asset URLs break project Pages")
    require("TODO" not in index and "Lorem ipsum" not in index, "placeholder copy found")
    require(not re.search(r"(?<!sans-)serif\b|Georgia|Times New Roman|Batang|바탕", styles, re.I), "serif typography is not allowed")

    analysis = json.loads((output / "data" / "analysis.json").read_text(encoding="utf-8"))
    players = analysis["players"]
    require(len(players) == analysis["meta"]["candidate_count"] >= 10, "candidate count mismatch")
    ids = [player["id"] for player in players]
    require(len(ids) == len(set(ids)), "player ids must be unique")
    require([player["rank"] for player in players] == list(range(1, len(players) + 1)), "ranks must be contiguous")
    require(all(0 <= player["score_low"] <= player["score"] <= player["score_high"] <= 100 for player in players), "score range invalid")
    require(all(0 <= player["robust_win_rate"] <= 100 for player in players), "win rate invalid")
    require(abs(sum(player["robust_win_rate"] for player in players) - 100) <= 0.2, "win rates must sum to 100")

    dimensions = analysis["methodology"]["dimensions"]
    dimension_keys = {item["key"] for item in dimensions}
    require(abs(sum(item["default_weight"] for item in dimensions) - 100) < 1e-9, "default weights must sum to 100")
    for player in players:
        require(set(player["dimensions"]) == dimension_keys, f"{player['id']}: dimension mismatch")
        require(player["case_for"] and player["case_against"], f"{player['id']}: two-sided case required")
        photo = player.get("photo", {})
        asset_path = Path(str(photo.get("asset_path", "")))
        require(asset_path.parts and not asset_path.is_absolute() and ".." not in asset_path.parts, f"{player['id']}: invalid photo path")
        require(str(photo.get("asset_path", "")).startswith("assets/players/"), f"{player['id']}: photo must be local")
        portrait = output / asset_path
        require(portrait.is_file() and portrait.stat().st_size >= 1_024, f"{player['id']}: photo missing")
        require(str(photo.get("source_url", "")).startswith("https://commons.wikimedia.org/"), f"{player['id']}: Commons source missing")
        require(str(photo.get("license_url", "")).startswith("https://"), f"{player['id']}: photo license URL invalid")
        require(bool(photo.get("author") and photo.get("license")), f"{player['id']}: photo attribution incomplete")

    for key, scenario in analysis["scenarios"].items():
        require(set(scenario["weights"]) == dimension_keys, f"{key}: weight keys mismatch")
        require(abs(sum(scenario["weights"].values()) - 100) < 1e-9, f"{key}: weights must sum to 100")
        require(len(scenario["rankings"]) == len(players), f"{key}: incomplete ranking")

    source_ids = {source["id"] for source in analysis["sources"]}
    require(len(source_ids) == len(analysis["sources"]), "source ids must be unique")
    for source in analysis["sources"]:
        parsed = urlparse(source["url"])
        require(parsed.scheme == "https" and parsed.netloc, f"invalid source URL: {source['id']}")
    for player in players:
        require(set(player["source_ids"]) <= source_ids, f"{player['id']}: unknown source reference")
        require(player.get("raw_stats"), f"{player['id']}: raw evidence ledger is empty")
        for label, item in player["raw_stats"].items():
            require(isinstance(item, dict) and item.get("value"), f"{player['id']}.{label}: value missing")
            require(item.get("scope") and item.get("coverage"), f"{player['id']}.{label}: scope missing")
            require(set(item.get("source_ids", [])) <= source_ids, f"{player['id']}.{label}: unknown source")

    media = analysis.get("media", [])
    require(len(media) == len(players), "photo credit count must match candidate count")
    require({entry.get("player_id") for entry in media} == set(ids), "photo credits must cover every player")

    manifest = json.loads((output / "data" / "manifest.json").read_text(encoding="utf-8"))
    require(manifest["analysis_cutoff"] == analysis["meta"]["as_of"], "manifest cutoff mismatch")
    require(len(manifest["inputs"]) >= 25, "provenance manifest is incomplete")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="dist")
    args = parser.parse_args()
    validate(Path(args.output))
    print(f"Validated report at {Path(args.output).resolve()}")


if __name__ == "__main__":
    main()
