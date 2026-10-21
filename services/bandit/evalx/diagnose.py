"""Where each policy places blocks, per world.

Run:  uv run python -m evalx.diagnose [--students 200] [--seed 0]
For each world and policy it places every task of ``students`` students (reaction
style ``ignore``, so no block is moved) and records the share of blocks that start
in the student's true band, the mean start hour, and the share that start within
two days of the deadline. Writes evalx/out/placement-diagnostic.json.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

import numpy as np

from evalx import run as harness
from evalx.world import (
    DAY_MS,
    HOUR_MS,
    Calendar,
    Student,
    Task,
    build_calendar,
    in_band,
    make_tasks,
)

POLICIES = ("H0", "H1", "L0", "S")


def diagnose(students: int, seed: int) -> dict[str, dict[str, float]]:
    harness.configure({})
    rows: dict[str, list[tuple[bool, float, float]]] = defaultdict(list)
    current = {"key": ""}
    react = harness.react

    def spy(
        s: Student, task: Task, start: int, style: str, cal: Calendar
    ) -> tuple[bool, str | None, float | None, int]:
        midnight = (start // DAY_MS) * DAY_MS
        rows[current["key"]].append(
            (
                in_band(s.at(task.arrival_ms), start, midnight),
                (start - midnight) / HOUR_MS,
                (task.deadline_ms - start) / DAY_MS,
            )
        )
        return react(s, task, start, style, cal)

    harness.react = spy
    try:
        out: dict[str, dict[str, float]] = {}
        for name, student in harness.worlds("all").items():
            for arm in POLICIES:
                current["key"] = f"{name}|{arm}"
                for i in range(students):
                    tasks = make_tasks(
                        random.Random(f"tasks:{seed}:{i}"),
                        harness.WEEKS,
                        harness.TASKS_PER_WEEK,
                    )
                    cal = build_calendar(
                        random.Random(f"calendar:{seed}:{i}"), harness.WEEKS * 7 + 10
                    )
                    harness.simulate(
                        student, tasks, arm, "ignore", random.Random(1), cal
                    )
                arr = np.array(rows[current["key"]], dtype=float)
                out[current["key"]] = {
                    "n": float(len(arr)),
                    "in_band": float(arr[:, 0].mean()),
                    "mean_hour": float(arr[:, 1].mean()),
                    "within_2d": float((arr[:, 2] <= 2).mean()),
                }
        return out
    finally:
        harness.react = react


def main() -> int:
    ap = argparse.ArgumentParser(prog="evalx.diagnose")
    ap.add_argument("--students", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    result = diagnose(args.students, args.seed)
    (args.out / "placement-diagnostic.json").write_text(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
