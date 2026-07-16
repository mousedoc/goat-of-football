#!/usr/bin/env python3
"""Build the reproducible GOAT multi-criteria analysis.

The input intentionally stores evidence-coded ranges rather than pretending that
incomplete historical event data are exact.  This module validates those ranges,
calculates declared scenarios, and propagates both rating and value uncertainty
through seeded Monte Carlo simulation using only the Python standard library.
"""

from __future__ import annotations

import json
import random
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "data" / "model.json"
CANDIDATES_PATH = ROOT / "data" / "candidates.json"
SOURCES_PATH = ROOT / "data" / "sources.json"
MEDIA_PATH = ROOT / "data" / "media.json"


class DataValidationError(ValueError):
    """Raised when an audited input violates the public model contract."""


@dataclass(frozen=True)
class DimensionRange:
    low: float
    mode: float
    high: float

    @classmethod
    def from_value(cls, value: Iterable[float], context: str) -> "DimensionRange":
        parts = list(value)
        if len(parts) != 3 or not all(isinstance(item, (int, float)) for item in parts):
            raise DataValidationError(f"{context}: expected [low, mode, high]")
        low, mode, high = (float(item) for item in parts)
        if not (0 <= low <= mode <= high <= 100):
            raise DataValidationError(f"{context}: require 0 <= low <= mode <= high <= 100")
        return cls(low, mode, high)

    def sample(self, rng: random.Random) -> float:
        return rng.triangular(self.low, self.high, self.mode)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalized_weights(weights: dict[str, float], dimension_keys: list[str]) -> dict[str, float]:
    if set(weights) != set(dimension_keys):
        missing = sorted(set(dimension_keys) - set(weights))
        extra = sorted(set(weights) - set(dimension_keys))
        raise DataValidationError(f"weight keys mismatch; missing={missing}, extra={extra}")
    if any(not isinstance(value, (int, float)) or value < 0 for value in weights.values()):
        raise DataValidationError("weights must be non-negative numbers")
    total = float(sum(weights.values()))
    if total <= 0:
        raise DataValidationError("at least one weight must be positive")
    return {key: float(weights[key]) / total for key in dimension_keys}


def weighted_score(values: dict[str, float], weights: dict[str, float]) -> float:
    return sum(values[key] * weights[key] for key in weights)


def sample_bounded_weights(
    rng: random.Random,
    base_weights: dict[str, float],
    minimum: dict[str, float],
    maximum: dict[str, float],
    concentration: float,
) -> dict[str, float]:
    """Sample plausible value judgements around the declared default.

    A Dirichlet distribution keeps the weights summing to one.  Broad public
    bounds reject implausible edge cases such as a 95% trophy-count model.
    """

    keys = list(base_weights)
    for _ in range(10_000):
        draws = {
            key: rng.gammavariate(max(base_weights[key] * concentration, 0.001), 1.0)
            for key in keys
        }
        total = sum(draws.values())
        sample = {key: draws[key] / total for key in keys}
        if all(minimum[key] <= sample[key] <= maximum[key] for key in keys):
            return sample
    raise RuntimeError("could not sample weights inside declared bounds")


def rank_scores(scores: dict[str, float]) -> list[tuple[str, float]]:
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


def raw_ledger(
    stats: dict[str, Any], source_ids: list[str], confidence: float, cutoff: str
) -> dict[str, dict[str, Any]]:
    limitation_markers = ("주의", "자료", "공백", "편향", "자격", "부상", "진행 중")
    return {
        label: {
            "value": value,
            "scope": "정의·한계" if any(marker in label for marker in limitation_markers) else "핵심 경쟁 이력",
            "coverage": f"증거 잠금 {cutoff}",
            "confidence": f"{round(confidence * 100)}%",
            "source_ids": source_ids,
        }
        for label, value in stats.items()
    }


def pareto_frontier(players: list[dict[str, Any]], dimension_keys: list[str]) -> list[str]:
    frontier: list[str] = []
    for candidate in players:
        candidate_values = {key: candidate["dimension_ranges"][key].mode for key in dimension_keys}
        dominated = False
        for challenger in players:
            if challenger["id"] == candidate["id"]:
                continue
            challenger_values = {key: challenger["dimension_ranges"][key].mode for key in dimension_keys}
            no_worse = all(challenger_values[key] >= candidate_values[key] for key in dimension_keys)
            strictly_better = any(challenger_values[key] > candidate_values[key] for key in dimension_keys)
            if no_worse and strictly_better:
                dominated = True
                break
        if not dominated:
            frontier.append(candidate["id"])
    return frontier


def validate_media(media: dict[str, Any], player_ids: set[str]) -> dict[str, dict[str, Any]]:
    """Validate locally vendored portraits and their mandatory attribution."""

    entries = media.get("players", [])
    media_by_player = {entry.get("player_id"): entry for entry in entries}
    if len(media_by_player) != len(entries) or None in media_by_player:
        raise DataValidationError("media player ids must be present and unique")
    if set(media_by_player) != player_ids:
        missing = sorted(player_ids - set(media_by_player))
        extra = sorted(set(media_by_player) - player_ids)
        raise DataValidationError(f"media coverage mismatch; missing={missing}, extra={extra}")

    required = {
        "wikidata_id",
        "commons_file",
        "asset_path",
        "source_url",
        "author",
        "license",
        "license_url",
    }
    for player_id, entry in media_by_player.items():
        missing_fields = sorted(field for field in required if not entry.get(field))
        if missing_fields:
            raise DataValidationError(f"{player_id}: missing media fields {missing_fields}")
        asset_path = Path(str(entry["asset_path"]))
        if asset_path.is_absolute() or ".." in asset_path.parts:
            raise DataValidationError(f"{player_id}: media asset path must be repository-relative")
        if asset_path.as_posix() != str(entry["asset_path"]):
            raise DataValidationError(f"{player_id}: media asset path must use POSIX separators")
        if not str(entry["asset_path"]).startswith("assets/players/"):
            raise DataValidationError(f"{player_id}: media asset must live under assets/players")
        if asset_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise DataValidationError(f"{player_id}: unsupported portrait format")
        local_asset = ROOT / "site" / asset_path
        if not local_asset.is_file() or local_asset.stat().st_size < 1_024:
            raise DataValidationError(f"{player_id}: portrait is missing or unexpectedly small")
        for field in ("source_url", "license_url"):
            if not str(entry[field]).startswith("https://"):
                raise DataValidationError(f"{player_id}: {field} must use https")
        position = str(entry.get("object_position", "50% 35%"))
        if not re.fullmatch(r"(?:100|\d{1,2})% (?:100|\d{1,2})%", position):
            raise DataValidationError(f"{player_id}: invalid object_position")
    return media_by_player


def validate_and_prepare(
    model: dict[str, Any], candidates: dict[str, Any], sources: dict[str, Any]
) -> tuple[list[str], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    dimensions = model.get("dimensions", [])
    if not dimensions:
        raise DataValidationError("model must declare dimensions")
    dimension_keys = [item["key"] for item in dimensions]
    if len(dimension_keys) != len(set(dimension_keys)):
        raise DataValidationError("dimension keys must be unique")

    default_weights = {item["key"]: item["default_weight"] for item in dimensions}
    normalized_weights(default_weights, dimension_keys)
    for scenario_key, scenario in model.get("scenarios", {}).items():
        normalized_weights(scenario.get("weights", {}), dimension_keys)
        if not scenario.get("label") or not scenario.get("description"):
            raise DataValidationError(f"scenario {scenario_key} needs label and description")

    source_list = sources.get("sources", [])
    source_by_id = {item["id"]: item for item in source_list}
    if len(source_by_id) != len(source_list):
        raise DataValidationError("source ids must be unique")
    for source in source_list:
        if not str(source.get("url", "")).startswith("https://"):
            raise DataValidationError(f"source {source.get('id')} must use an https URL")

    prepared: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw in candidates.get("players", []):
        player_id = raw.get("id")
        if not player_id or player_id in seen_ids:
            raise DataValidationError(f"invalid or duplicate player id: {player_id!r}")
        seen_ids.add(player_id)
        if set(raw.get("dimensions", {})) != set(dimension_keys):
            raise DataValidationError(f"{player_id}: dimensions do not match model")
        ranges = {
            key: DimensionRange.from_value(raw["dimensions"][key], f"{player_id}.{key}")
            for key in dimension_keys
        }
        confidence = raw.get("confidence")
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise DataValidationError(f"{player_id}: confidence must be between 0 and 1")
        unknown_sources = sorted(set(raw.get("source_ids", [])) - set(source_by_id))
        if unknown_sources:
            raise DataValidationError(f"{player_id}: unknown sources {unknown_sources}")
        if not raw.get("case_for") or not raw.get("case_against"):
            raise DataValidationError(f"{player_id}: both case_for and case_against are required")
        player = dict(raw)
        player["dimension_ranges"] = ranges
        prepared.append(player)

    if len(prepared) < 10:
        raise DataValidationError("a cross-era report requires at least ten candidates")
    return dimension_keys, prepared, source_by_id


def build_analysis(generated_at: str | None = None) -> dict[str, Any]:
    model = load_json(MODEL_PATH)
    candidates = load_json(CANDIDATES_PATH)
    sources = load_json(SOURCES_PATH)
    media = load_json(MEDIA_PATH)
    dimension_keys, players, source_by_id = validate_and_prepare(model, candidates, sources)
    media_by_player = validate_media(media, {player["id"] for player in players})

    base_weight_percent = {item["key"]: item["default_weight"] for item in model["dimensions"]}
    base_weights = normalized_weights(base_weight_percent, dimension_keys)
    sampling = model["weight_sampling"]
    minimum = {key: sampling["minimum"][key] / 100 for key in dimension_keys}
    maximum = {key: sampling["maximum"][key] / 100 for key in dimension_keys}

    modes = {
        player["id"]: {key: player["dimension_ranges"][key].mode for key in dimension_keys}
        for player in players
    }
    base_scores = {player_id: weighted_score(values, base_weights) for player_id, values in modes.items()}
    base_lower = {
        player["id"]: weighted_score(
            {key: player["dimension_ranges"][key].low for key in dimension_keys}, base_weights
        )
        for player in players
    }
    base_upper = {
        player["id"]: weighted_score(
            {key: player["dimension_ranges"][key].high for key in dimension_keys}, base_weights
        )
        for player in players
    }
    base_ranking = rank_scores(base_scores)

    rng = random.Random(model["seed"])
    iterations = int(model["iterations"])
    rank_samples: dict[str, list[int]] = {player["id"]: [] for player in players}
    wins: Counter[str] = Counter()
    top3: Counter[str] = Counter()
    pairwise: dict[str, Counter[str]] = {player["id"]: Counter() for player in players}

    scenario_centres = [
        normalized_weights(scenario["weights"], dimension_keys)
        for scenario in model["scenarios"].values()
    ]
    for _ in range(iterations):
        centre_weights = rng.choice(scenario_centres)
        sampled_weights = sample_bounded_weights(
            rng,
            centre_weights,
            minimum,
            maximum,
            float(sampling["concentration"]),
        )
        iteration_scores = {
            player["id"]: weighted_score(
                {key: player["dimension_ranges"][key].sample(rng) for key in dimension_keys},
                sampled_weights,
            )
            for player in players
        }
        ranked = rank_scores(iteration_scores)
        wins[ranked[0][0]] += 1
        for player_id, _ in ranked[:3]:
            top3[player_id] += 1
        for rank, (player_id, score) in enumerate(ranked, start=1):
            rank_samples[player_id].append(rank)
            for other_id, other_score in iteration_scores.items():
                if player_id != other_id and score > other_score:
                    pairwise[player_id][other_id] += 1

    scenario_output: dict[str, Any] = {}
    scenario_ranks: dict[str, list[int]] = {player["id"]: [] for player in players}
    for scenario_key, scenario in model["scenarios"].items():
        weights = normalized_weights(scenario["weights"], dimension_keys)
        scores = {player_id: weighted_score(values, weights) for player_id, values in modes.items()}
        ranked = rank_scores(scores)
        ranking_rows = []
        for rank, (player_id, score) in enumerate(ranked, start=1):
            scenario_ranks[player_id].append(rank)
            ranking_rows.append({"rank": rank, "player_id": player_id, "score": round(score, 1)})
        scenario_output[scenario_key] = {
            "label": scenario["label"],
            "description": scenario["description"],
            "weights": scenario["weights"],
            "winner": ranked[0][0],
            "rankings": ranking_rows,
        }

    base_rank_by_id = {player_id: rank for rank, (player_id, _) in enumerate(base_ranking, start=1)}
    output_players: list[dict[str, Any]] = []
    for player in players:
        player_id = player["id"]
        ranks = rank_samples[player_id]
        rank_counts = Counter(ranks)
        modal_rank, modal_count = sorted(rank_counts.items(), key=lambda item: (-item[1], item[0]))[0]
        output_players.append(
            {
                "id": player_id,
                "name_ko": player["name_ko"],
                "name_en": player["name_en"],
                "country": player["country"],
                "era": player["era"],
                "position": player["position"],
                "position_group": player["position_group"],
                "color": player["color"],
                "photo": {
                    key: value
                    for key, value in media_by_player[player_id].items()
                    if key not in {"player_id", "download_url"}
                },
                "confidence": round(float(player["confidence"]) * 100),
                "rank": base_rank_by_id[player_id],
                "score": round(base_scores[player_id], 1),
                "score_low": round(base_lower[player_id], 1),
                "score_high": round(base_upper[player_id], 1),
                "rank_stability": round(top3[player_id] / iterations * 100, 1),
                "robust_win_rate": round(wins[player_id] / iterations * 100, 1),
                "modal_rank": modal_rank,
                "modal_rank_rate": round(modal_count / iterations * 100, 1),
                "best_scenario_rank": min(scenario_ranks[player_id]),
                "worst_scenario_rank": max(scenario_ranks[player_id]),
                "dimensions": {key: round(modes[player_id][key], 1) for key in dimension_keys},
                "dimension_ranges": {
                    key: {
                        "low": player["dimension_ranges"][key].low,
                        "mode": player["dimension_ranges"][key].mode,
                        "high": player["dimension_ranges"][key].high,
                    }
                    for key in dimension_keys
                },
                "raw_stats": raw_ledger(
                    player["raw_stats"],
                    player["source_ids"],
                    float(player["confidence"]),
                    model["scope"]["cutoff"],
                ),
                "case_for": player["case_for"],
                "case_against": player["case_against"],
                "evidence_note": player["evidence_note"],
                "source_ids": player["source_ids"],
            }
        )
    output_players.sort(key=lambda player: player["rank"])

    ranking_output = [
        {
            "rank": rank,
            "player_id": player_id,
            "score": round(score, 1),
            "score_low": round(base_lower[player_id], 1),
            "score_high": round(base_upper[player_id], 1),
        }
        for rank, (player_id, score) in enumerate(base_ranking, start=1)
    ]

    top_ids = [player_id for player_id, _ in base_ranking[:3]]
    pairwise_output = {
        player_id: {
            other_id: round(pairwise[player_id][other_id] / iterations * 100, 1)
            for other_id in top_ids
            if other_id != player_id
        }
        for player_id in top_ids
    }
    wins_output = sorted(
        ({"player_id": player["id"], "rate": round(wins[player["id"]] / iterations * 100, 1)} for player in players),
        key=lambda item: (-item["rate"], item["player_id"]),
    )
    top3_output = sorted(
        ({"player_id": player["id"], "rate": round(top3[player["id"]] / iterations * 100, 1)} for player in players),
        key=lambda item: (-item["rate"], item["player_id"]),
    )

    generated_at = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    winner_id = base_ranking[0][0]
    runner_up_id = base_ranking[1][0]
    winner_pairwise = pairwise[winner_id][runner_up_id] / iterations * 100
    winner_share = wins[winner_id] / iterations * 100
    conclusion_strength = "강건한 선두" if winner_share >= 70 and winner_pairwise >= 75 else "조건부 선두"

    return {
        "meta": {
            "title": "THE GOAT INDEX",
            "subtitle": "축구 역사상 최고의 선수를 묻는 질문을, 답보다 가정이 먼저 보이도록 분석하다",
            "as_of": model["scope"]["cutoff"],
            "generated_at": generated_at,
            "method_version": model["method_version"],
            "iterations": iterations,
            "candidate_count": len(players),
            "coverage_note": "진행 중인 2026 월드컵은 제외. 과거 결측은 0점이 아니라 넓은 불확실성 구간으로 처리",
            "scope": model["scope"],
        },
        "finding": {
            "leader_id": winner_id,
            "runner_up_id": runner_up_id,
            "label": conclusion_strength,
            "headline": f"기본 가정에서는 {next(player['name_ko'] for player in players if player['id'] == winner_id)}가 1위다.",
            "interpretation": (
                "이 결과는 누가 객관적으로 더 위대할 확률이 아니라, 공개한 점수 구간과 합리적 가중치 조합에서 "
                f"1위를 차지한 비율({winner_share:.1f}%)이다. 가중치와 역사 자료의 한계를 바꾸면 순위도 바뀐다."
            ),
        },
        "methodology": {
            "summary": (
                "전 시대에 동일한 정밀 이벤트 데이터가 없으므로, 확인 가능한 공식 기록·동시대 평가·역할 증거를 "
                "Peak3, Prime5, Career AUC, 클럽/대표팀 맥락, 제한적 업적 이력의 범위로 코딩하고 불확실성을 전파한다."
            ),
            "principles": [
                "결측은 0점이 아니다. 자료가 적은 시대와 포지션은 더 넓은 구간을 갖는다.",
                "총득점·총우승을 그대로 합산하지 않는다. 대회 확대, 페널티, 팀 강도, 포지션을 맥락으로 본다.",
                "업적 이력은 기본 총점의 5%뿐이다. 우승은 개인 능력의 자격시험이 아니다.",
                "몬테카를로 1위 비율은 진실 확률이 아니라 이 모델 내부의 강건성이다.",
                "진행 중 대회는 잠정 참고로만 두고 완료된 뒤 검증 스냅샷으로 승격한다.",
            ],
            "dimensions": model["dimensions"],
            "caveats": [
                "후보 선정과 범위 코딩에는 판단이 들어간다. 원자료·루브릭·코드를 공개해 반박 가능하게 만들었다.",
                "여자축구는 열등해서가 아니라 역사적 경쟁 구조와 데이터 생성 과정이 달라 별도 모델이 필요해 본 순위에서 제외했다.",
                "현대 xG·xA·VAEP는 과거에 존재하지 않는다. 현대 심층 지표를 공통 핵심 점수에 합산하지 않았다.",
                "펠레·가린샤·디 스테파노·야신 등은 분·도움·이벤트 기록 부족으로 결과 구간이 특히 넓다.",
                "득점, 우승, 개인상, 큰 경기 기억은 서로 상관되어 있다. 중복 계산을 완전히 제거할 수 없다.",
            ],
            "candidate_rule": candidates["candidate_rule"],
            "rating_rule": candidates["rating_rule"],
            "sampling": {
                "distribution": "각 차원은 삼각분포. 가중치는 공개한 6개 가치 시나리오를 균등 선택한 뒤 그 주변의 제한된 Dirichlet 분포",
                "interval": "점수 구간은 각 차원의 보수적 하한·상한을 기본 가중치로 결합한 구조적 범위",
                "seed": model["seed"],
                "weight_bounds": sampling,
            },
        },
        "players": output_players,
        "rankings": ranking_output,
        "scenarios": scenario_output,
        "sensitivity": {
            "wins": wins_output,
            "top3": top3_output,
            "pairwise": pairwise_output,
            "note": "비율은 입력 범위와 허용 가중치 안에서만 유효하며 실제 세계의 확률로 해석하면 안 된다.",
        },
        "pareto_frontier": pareto_frontier(players, dimension_keys),
        "sources": [dict(source, accessed=sources["accessed"]) for source in source_by_id.values()],
        "media": [
            {
                key: value
                for key, value in entry.items()
                if key != "download_url"
            }
            | {"accessed": media["accessed"]}
            for entry in media["players"]
        ],
        "glossary": [
            {"term": "Peak 3", "definition": "최고 3개 시즌의 역할·시대 상대 개인 기여를 요약한 범위"},
            {"term": "Prime 5", "definition": "최고 연속 5개 시즌의 개인 기여와 전술적 중심성"},
            {"term": "Career AUC", "definition": "엘리트 기준선을 넘은 시즌별 가치의 누적 면적"},
            {"term": "점수 범위", "definition": "각 증거 차원의 보수적 하한·상한을 기본 가중치로 결합한 구조적 불확실성 범위"},
            {"term": "강건성", "definition": "허용한 합리적 가정 변화에도 결론이 유지되는 정도. 진실 확률은 아님"},
            {"term": "Pareto frontier", "definition": "어느 한 차원을 개선하려면 다른 차원을 희생해야 하는 비지배 후보 집합"},
        ],
    }


if __name__ == "__main__":
    print(json.dumps(build_analysis(), ensure_ascii=False, indent=2))
