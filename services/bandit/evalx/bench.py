"""Time per inference and per learning step, on the production code path.

Run:  uv run python -m evalx.bench [--students 20] [--seed 0]
Plays sampled semester students serially through the single-policy arms and times each
``run_place`` call (inference: validate, build features, score every arm, scan
slots) and each ``update_arm`` call (learning: hydrate, rank-one update).
In-process, one thread, no HTTP and no database. Writes evalx/out/bench.json.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

from evalx import run as harness
from evalx.academic_calendar import build_semester
from evalx.semester import simulate_arm
from evalx.student_behavior import sample_student

ARMS = ("H", "L")


def bench(students: int, seed: int) -> dict[str, dict[str, dict[str, float]]]:
    """Per arm: milliseconds per ``place`` and per ``update`` call."""
    harness.configure({"mode": "semester"})
    times: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    current = {"arm": ""}
    place, learn = harness.run_place, harness.update_arm

    def timed_place(*args, **kwargs):  # type: ignore[no-untyped-def]
        t = time.perf_counter()
        out = place(*args, **kwargs)
        times[current["arm"]]["place"].append(1e3 * (time.perf_counter() - t))
        return out

    def timed_learn(*args, **kwargs):  # type: ignore[no-untyped-def]
        t = time.perf_counter()
        out = learn(*args, **kwargs)
        times[current["arm"]]["update"].append(1e3 * (time.perf_counter() - t))
        return out

    harness.run_place = timed_place
    harness.update_arm = timed_learn
    try:
        for arm in ARMS:
            current["arm"] = arm
            for i in range(students):
                student = sample_student(random.Random(f"student:{seed}:{i}"), i)
                sem = build_semester(random.Random(f"semester:{seed}:{i}"))
                simulate_arm(student, sem, arm, random.Random(1))
    finally:
        harness.run_place = place
        harness.update_arm = learn
    out: dict[str, dict[str, dict[str, float]]] = {}
    for arm, ops in times.items():
        out[arm] = {}
        for op, v in ops.items():
            a = np.asarray(v[10:])  # drop warm-up calls
            out[arm][op] = {
                "n": float(len(a)),
                "mean_ms": float(a.mean()),
                "p50_ms": float(np.quantile(a, 0.5)),
                "p95_ms": float(np.quantile(a, 0.95)),
                "p99_ms": float(np.quantile(a, 0.99)),
            }
    return out


def render(res: dict[str, dict[str, dict[str, float]]]) -> str:
    lines = [
        "| Arm | Step | Calls | Mean ms | p50 ms | p95 ms | p99 ms |",
        "|---|---|---|---|---|---|---|",
    ]
    for arm, ops in res.items():
        for op, r in ops.items():
            lines.append(
                f"| {arm} | {op} | {r['n']:.0f} | {r['mean_ms']:.2f} "
                f"| {r['p50_ms']:.2f} | {r['p95_ms']:.2f} | {r['p99_ms']:.2f} |"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(prog="evalx.bench")
    ap.add_argument("--students", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    res = bench(args.students, args.seed)
    (args.out / "bench.json").write_text(json.dumps(res, indent=1) + "\n")
    print(render(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
