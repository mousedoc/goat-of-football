from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.analyze import (
    CANDIDATES_PATH,
    MODEL_PATH,
    SOURCES_PATH,
    DataValidationError,
    build_analysis,
    load_json,
    normalized_weights,
    validate_and_prepare,
)
from scripts.build_report import build
from scripts.validate_report import validate


class AnalysisTests(unittest.TestCase):
    def test_analysis_is_reproducible(self) -> None:
        first = build_analysis("2026-07-16T00:00:00+00:00")
        second = build_analysis("2026-07-16T00:00:00+00:00")
        self.assertEqual(first, second)

    def test_public_invariants(self) -> None:
        result = build_analysis("test")
        self.assertEqual(result["players"][0]["id"], result["finding"]["leader_id"])
        self.assertAlmostEqual(sum(row["rate"] for row in result["sensitivity"]["wins"]), 100, delta=0.2)
        self.assertGreaterEqual(len(result["pareto_frontier"]), 2)
        self.assertEqual(
            [player["rank"] for player in result["players"]],
            list(range(1, len(result["players"]) + 1)),
        )
        for player in result["players"]:
            self.assertLessEqual(player["score_low"], player["score"])
            self.assertLessEqual(player["score"], player["score_high"])

    def test_invalid_dimension_range_is_rejected(self) -> None:
        model = load_json(MODEL_PATH)
        candidates = load_json(CANDIDATES_PATH)
        sources = load_json(SOURCES_PATH)
        broken = copy.deepcopy(candidates)
        broken["players"][0]["dimensions"]["peak"] = [99, 80, 100]
        with self.assertRaises(DataValidationError):
            validate_and_prepare(model, broken, sources)

    def test_weights_are_normalized(self) -> None:
        weights = normalized_weights({"a": 2, "b": 3}, ["a", "b"])
        self.assertEqual(weights, {"a": 0.4, "b": 0.6})

    def test_built_site_validates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "report"
            build(output)
            validate(output)
            analysis = json.loads((output / "data" / "analysis.json").read_text(encoding="utf-8"))
            self.assertEqual(analysis["meta"]["candidate_count"], 15)


if __name__ == "__main__":
    unittest.main()
