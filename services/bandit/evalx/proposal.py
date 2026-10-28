"""Proposal metrics from a semester run's part files.

Definitions follow ``docs/scheduler/heuristic-vs-linucb-report.md`` section 3.
A proposal is a placed task. Regret is the hidden done chance of the best free
slot minus the proposed one, kept excludes moved and deleted proposals, and
drag is minutes moved (0 when kept). Figures pool every proposal; intervals
resample students, and paired contrasts resample the same students for both arms.

Run ``python -m evalx.proposal summary --parts DIR`` for one run, or
``python -m evalx.proposal robust --out DIR ...`` for the 15 reality worlds.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

import numpy as np

BOOTSTRAP = 2000
COUNTS = ("n", "kept", "reg", "drag", "first_n", "first_reg", "late_n", "late_reg")
Cols = dict[str, np.ndarray]


def first_reaching(kept: list[float], share: float) -> int:
    """First n >= 10 where ``share`` of proposals n-9..n were kept, else the count."""
    n = len(kept)
    for k in range(10, n + 1):
        if sum(kept[k - 10 : k]) >= 10 * share:
            return k
    return n


def load(parts: Path) -> dict[str, Cols]:
    """Per-student arrays for each arm, aligned by student across arms.

    ``chrono`` holds each student's chronotype, for the by-group tables.
    """
    lists: dict[str, dict[str, list[float]]] = {}
    chrono: list[str] = []
    for path in sorted(parts.glob("seed-*.json")):
        for st in json.loads(path.read_text())["students"]:
            chrono.append(st["meta"]["chronotype"])
            for arm, p in st["proposal"].items():
                keys = (*COUNTS, "to60", "to90", "margin", "adh")
                cols = lists.setdefault(arm, {k: [] for k in keys})
                rows = st["arms"][arm]
                cols["adh"].append(float(np.mean([r["s"] for r in rows])))
                for k in COUNTS + ("to60",):
                    cols[k].append(p[k])
                placed = [r for r in st["arms"][arm] if r["m"] is not None]
                kept = [1.0 - r["mov"] - r["del"] for r in placed]
                cols["to90"].append(first_reaching(kept, 0.9))
                margins = [r["m"] for r in placed]
                cols["margin"].append(float(np.mean(margins)) if margins else np.nan)
    if not lists:
        raise SystemExit(f"no part files with proposal data under {parts}")
    out = {arm: {k: np.asarray(v) for k, v in c.items()} for arm, c in lists.items()}
    for cols in out.values():
        cols["chrono"] = np.asarray(chrono)
    return out


def subset(cols: Cols, group: str) -> Cols:
    """The students of one chronotype, arrays cut to them."""
    keep = cols["chrono"] == group
    return {k: v[keep] for k, v in cols.items()}


def _sum_ratio(num: str, den: str) -> Callable[[Cols, np.ndarray], float]:
    def fn(c: Cols, i: np.ndarray) -> float:
        return float(c[num][i].sum() / c[den][i].sum())

    return fn


METRICS: dict[str, Callable[[Cols, np.ndarray], float]] = {
    "Regret": _sum_ratio("reg", "n"),
    "Kept": _sum_ratio("kept", "n"),
    "Drag (min)": _sum_ratio("drag", "n"),
    "To 60%": lambda c, i: float(c["to60"][i].mean()),
    "Regret, first 10": _sum_ratio("first_reg", "first_n"),
    "Regret, 40+": _sum_ratio("late_reg", "late_n"),
}
# Lower is better for every metric except kept.
HIGHER_BETTER = {"Kept"}


def _resamples(students: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, students, size=(BOOTSTRAP, students))


def interval(
    fn: Callable[[Cols, np.ndarray], float], cols: Cols, draws: np.ndarray
) -> tuple[float, float, float]:
    everyone = np.arange(len(cols["n"]))
    point = fn(cols, everyone)
    values = np.array([fn(cols, d) for d in draws])
    lo, hi = np.percentile(values, [2.5, 97.5])
    return point, float(lo), float(hi)


def paired(
    fn: Callable[[Cols, np.ndarray], float],
    a: Cols,
    b: Cols,
    draws: np.ndarray,
) -> tuple[float, float, float]:
    everyone = np.arange(len(a["n"]))
    point = fn(a, everyone) - fn(b, everyone)
    values = np.array([fn(a, d) - fn(b, d) for d in draws])
    lo, hi = np.percentile(values, [2.5, 97.5])
    return float(point), float(lo), float(hi)


def _fmt(metric: str, v: float) -> str:
    if metric == "Kept":
        return f"{100 * v:.1f}%"
    if metric == "Drag (min)":
        return f"{v:.0f}"
    if metric == "To 60%":
        return f"{v:.1f}"
    return f"{v:.3f}"


def _fmt_diff(metric: str, v: float, lo: float, hi: float) -> str:
    scale = 100 if metric == "Kept" else 1
    unit = " pts" if scale == 100 else ""
    return f"{scale * v:+.2f}{unit} [{scale * lo:+.2f}, {scale * hi:+.2f}]"


def summary_table(arms: dict[str, Cols], order: list[str]) -> str:
    """Per arm: each metric with its 95% interval over students."""
    draws = _resamples(len(next(iter(arms.values()))["n"]), seed=1)
    head = "| Arm | " + " | ".join(METRICS) + " |"
    lines = [head, "|" + "---|" * (len(METRICS) + 1)]
    for arm in order:
        cells = []
        for name, fn in METRICS.items():
            point, lo, hi = interval(fn, arms[arm], draws)
            cells.append(f"{_fmt(name, point)} [{_fmt(name, lo)}, {_fmt(name, hi)}]")
        lines.append(f"| {arm} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def contrast_table(arms: dict[str, Cols], pairs: list[tuple[str, str]]) -> str:
    """Paired differences ``a - b`` per metric, same students for both arms."""
    draws = _resamples(len(next(iter(arms.values()))["n"]), seed=2)
    head = "| Contrast | " + " | ".join(METRICS) + " |"
    lines = [head, "|" + "---|" * (len(METRICS) + 1)]
    for a, b in pairs:
        cells = []
        for name, fn in METRICS.items():
            v, lo, hi = paired(fn, arms[a], arms[b], draws)
            cells.append(_fmt_diff(name, v, lo, hi))
        lines.append(f"| {a} minus {b} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def _pairs(text: str) -> list[tuple[str, str]]:
    """``a:b,c:d`` as contrasts ``a minus b`` and ``c minus d``."""
    out = []
    for p in text.split(","):
        if p:
            a, b = p.split(":", 1)
            out.append((a, b))
    return out


def robust(
    out: Path,
    arms: tuple[str, ...],
    pairs: list[tuple[str, str]],
    seeds: int,
    students: int,
    offset: int,
    workers: int,
) -> str:
    """Each reality world with the contrasts in ``pairs``. Finished seeds are reused."""
    from evalx import run as core
    from evalx.semester import REALITY

    lines = []
    for idx, (name, cfg) in enumerate(REALITY.items()):
        world = out / f"world-{idx:02d}"
        if not any((world / "parts").glob("*/seed-*.json")):
            core.run_all(seeds, students, arms, workers, world, offset, cfg)
        digests = (world / "parts").iterdir()
        cols = load(max(digests, key=lambda d: len(list(d.glob("seed-*.json")))))
        lines += [f"### {name}", "", contrast_table(cols, pairs), ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="evalx.proposal")
    sub = ap.add_subparsers(dest="cmd", required=True)
    one = sub.add_parser("summary", help="one run: every arm and the contrasts")
    one.add_argument("--parts", type=Path, required=True)
    one.add_argument("--arms", required=True)
    one.add_argument("--pairs", default="", help="a:b,c:d")
    one.add_argument("--by", default="", help="chrono: one table per chronotype")
    rob = sub.add_parser("robust", help="the 15 reality worlds")
    rob.add_argument("--out", type=Path, required=True)
    rob.add_argument("--arms", required=True)
    rob.add_argument("--pairs", default="", help="a:b,c:d (contrasts)")
    rob.add_argument("--seeds", type=int, default=100)
    rob.add_argument("--students", type=int, default=20)
    rob.add_argument("--seed-offset", type=int, default=1000)
    rob.add_argument("--workers", type=int, default=8)
    rob.add_argument("--config", default="{}")
    args = ap.parse_args(argv)
    if args.cmd == "summary":
        arms_order = args.arms.split(",")
        cols = load(args.parts)
        if args.by == "chrono":
            for group in sorted(set(cols[arms_order[0]]["chrono"])):
                print(f"### {group}\n")
                part = {a: subset(cols[a], group) for a in arms_order}
                print(summary_table(part, arms_order))
                print()
            return 0
        print(summary_table(cols, arms_order))
        if args.pairs:
            print()
            print(contrast_table(cols, _pairs(args.pairs)))
        return 0
    from evalx import run as core

    core.configure(json.loads(args.config))
    arms = tuple(args.arms.split(","))
    pairs = _pairs(args.pairs)
    report = robust(
        args.out, arms, pairs, args.seeds, args.students, args.seed_offset, args.workers
    )
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
