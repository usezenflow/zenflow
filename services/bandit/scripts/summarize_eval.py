"""Summarise simulator reports across seeds into one markdown table.

Usage: ``uv run python -m scripts.summarize_eval <sweep-dir> <config> [<config> ...]``

Each ``<config>`` is a sub-directory of ``<sweep-dir>`` holding one
``seed-N/report.json`` per seed (what ``python -m src.simulation.run --out-dir``
writes). Values are the mean over seeds; the seed range is shown so the spread is
visible. Diffs are LinUCB minus heuristic within the same run.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from statistics import mean

METRICS = ("started", "done", "lapsed", "chose_option", "drag", "regret")


def load(config_dir: Path) -> list[dict[str, object]]:
    return [
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted(config_dir.glob("seed-*/report.json"))
    ]


def first_start_medians(report: dict[str, object]) -> tuple[float, float]:
    rows = report["time_to_first_start"]
    assert isinstance(rows, dict)
    heur = mean(float(r["median_heuristic"]) for r in rows.values())
    lin = mean(float(r["median_linucb"]) for r in rows.values())
    return heur, lin


def summarise(config_dir: Path) -> dict[str, float]:
    reports = load(config_dir)
    if not reports:
        raise SystemExit(f"no seed reports under {config_dir}")
    out: dict[str, float] = {"seeds": float(len(reports))}
    for m in METRICS:
        out[f"{m}_H"] = mean(r["overall"][m]["heuristic"] for r in reports)
        out[f"{m}_L"] = mean(r["overall"][m]["linucb"] for r in reports)
        out[f"{m}_diff"] = mean(r["overall"][m]["diff"] for r in reports)
    out["early_started_H"] = mean(
        r["by_bucket"]["0-5"]["started"]["heuristic"] for r in reports
    )
    out["early_started_L"] = mean(
        r["by_bucket"]["0-5"]["started"]["linucb"] for r in reports
    )
    out["early_started_diff"] = mean(
        r["by_bucket"]["0-5"]["started"]["diff"] for r in reports
    )
    firsts = [first_start_medians(r) for r in reports]
    out["first_start_H"] = mean(h for h, _ in firsts)
    out["first_start_L"] = mean(lin for _, lin in firsts)
    return out


def main(argv: list[str]) -> int:
    sweep = Path(argv[1])
    configs = argv[2:]
    cols = (
        "seeds",
        "started_H", "started_L", "started_diff",
        "early_started_H", "early_started_L", "early_started_diff",
        "done_diff", "lapsed_diff", "chose_option_L", "drag_L", "drag_diff",
        "regret_H", "regret_L", "first_start_H", "first_start_L",
    )  # fmt: skip
    print("| config | " + " | ".join(cols) + " |")
    print("|---" * (len(cols) + 1) + "|")
    for name in configs:
        s = summarise(sweep / name)
        cells = [
            f"{s[c]:.0f}"
            if c == "seeds"
            else f"{s[c]:+.3f}"
            if c.endswith("diff")
            else f"{s[c]:.3f}"
            for c in cols
        ]
        print(f"| {name} | " + " | ".join(cells) + " |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
