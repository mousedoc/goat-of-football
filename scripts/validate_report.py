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
    "football-theme.css",
    "tokens.css",
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
    styles = (output / "football-theme.css").read_text(encoding="utf-8")
    tokens = (output / "tokens.css").read_text(encoding="utf-8")
    app = (output / "app.js").read_text(encoding="utf-8")
    require('lang="ko"' in index or "lang='ko'" in index, "index.html must declare Korean language")
    require("name=\"viewport\"" in index or "name='viewport'" in index, "viewport meta is required")
    require("<title>" in index, "document title is required")
    require("skip" in index.lower(), "a keyboard skip link is required")
    require(not re.search(r"(?:src|href)=[\"']/", index), "root-absolute asset URLs break project Pages")
    require("TODO" not in index and "Lorem ipsum" not in index, "placeholder copy found")
    require(not re.search(r"(?<!sans-)serif\b|Georgia|Times New Roman|Batang|바탕", f"{styles}\n{tokens}", re.I), "serif typography is not allowed")
    require(styles.lstrip().startswith("/* Hallmark"), "Hallmark design stamp is required")
    require('@import url("./tokens.css")' in styles, "football theme must import portable tokens")
    require(styles.count("overflow-x: clip") >= 2, "html and body must both use overflow-x: clip")
    require("prefers-reduced-motion: reduce" in styles, "reduced-motion fallback is required")
    require("slop: pass (42–45)" in styles and "mobile: pass (34, 49, 50–57)" in styles, "Hallmark audit stamp is incomplete")
    require(not re.search(r"#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(", styles, re.I), "theme CSS must consume color tokens only")
    require(not re.search(r"font-style:\s*italic|transition(?:-property)?:\s*all|100vw|overflow-x:\s*hidden|font-size:\s*0\b", styles, re.I), "Hallmark anti-slop guard failed")
    require(all(value.strip().startswith("var(--font-") for value in re.findall(r"font-family:\s*([^;]+);", styles)), "theme CSS must consume font tokens only")
    require(all("oklch(" in line for line in tokens.splitlines() if line.strip().startswith("--color-")), "all color tokens must use OKLCH")
    require("section-index" not in index, "decorative numbered section eyebrows are not allowed")
    require('class="mobile-nav"' in index and 'aria-controls="mobile-nav-panel"' in index, "accessible mobile navigation is required")
    require(index.count('role="region"') >= 2 and index.count('tabindex="0"') >= 3, "scrollable data regions must be keyboard reachable")
    require("winner-radar" in index and "dossier-radar" in index and "compare-radar" in index, "radar chart mounts are incomplete")
    require("renderRadarChart" in app and "aria-valuetext" in app, "accessible visualisation controls are incomplete")

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
