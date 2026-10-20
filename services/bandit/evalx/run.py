"""Offline eval: does LinUCB get simulated students to start more tasks?

Each simulated student gets the same tasks and the same random draws under
every arm, so arms differ only in where the task is placed (common random
numbers). The production placer is called over HTTP, exactly as Nest does.

Arms
  H0      heuristic primary, default preference map, learns from START / MOVE
  H1      heuristic primary, map seeded from the student's stated band (1.0 in
          band, 0.2 outside), then learns; assumes the stated band is right
  L0      LinUCB primary, cold start, learns from START / MOVE (as in production)
  Rand    a random start in the task's window (floor)
  Oracle  always the centre of the student's band (ceiling)

Run: ``uv run python -m evalx run`` (see ``--help``). Writes results.json and
report.md under ``evalx/out/``.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("LOG_LEVEL", "WARNING")  # the placer logs every request

from fastapi.testclient import TestClient  # noqa: E402

from evalx.world import (  # noqa: E402
    ARCHETYPES,
    DAY_MS,
    HOUR_MS,
    Student,
    Task,
    band_centre_ms,
    day_str,
    in_band,
    make_tasks,
    open_chance,
)
from src.api import app  # noqa: E402
from src.core.constants import MS_PER_MINUTE, PREFERENCE_KEPT_WEIGHT  # noqa: E402
from src.core.preference import (  # noqa: E402
    default_preference_matrix,
    matrix_index,
    reinforce_preference_cell,
    reinforce_preference_move,
)
from src.core.reward import drag_distance_reward  # noqa: E402
from src.schemas import ARM_IDS  # noqa: E402
from src.schemas_place import PLACEMENT_CONTRACT_VERSION  # noqa: E402

ALPHA = 0.15  # BANDIT_ALPHA, backend/src/scheduler/constants.ts
RIDGE = 1.0  # BANDIT_RIDGE
ARMS = ("H0", "H1", "L0", "Rand", "Oracle")
ZERO_WORKLOAD = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}


# --- HTTP placement ----------------------------------------------------------


def _days(first_ms: int, last_ms: int) -> list[dict[str, Any]]:
    out = []
    ms = first_ms
    while ms <= last_ms:
        out.append(
            {
                "dayStr": day_str(ms),
                "dayStartMs": ms,
                "dayEndMs": ms + DAY_MS,
                "occupied": [],
                "workloadByType": ZERO_WORKLOAD,
            }
        )
        ms += DAY_MS
    return out


def _place(
    client: TestClient, task: Task, primary: str, state: dict, matrix: Any, n: int
) -> dict[str, Any] | None:
    """One placement through /v1/place. ``None`` when the placer finds no slot."""
    first_day = (task.arrival_ms // DAY_MS) * DAY_MS
    last_day = ((task.deadline_ms - 1) // DAY_MS) * DAY_MS
    body: dict[str, Any] = {
        "contractVersion": PLACEMENT_CONTRACT_VERSION,
        "requestId": f"eval-{n}",
        "mode": "PLACE",
        "nowMs": task.arrival_ms,
        "timezone": "UTC",
        "deadlineMs": task.deadline_ms,
        "maxScanDays": 30,
        "members": [
            {
                "id": "t",
                "durationMinutes": task.duration_min,
                "primaryPolicy": primary,
                "computeBoth": False,
            }
        ],
        "fixedOccupied": [],
        "days": _days(first_day, last_day),
        "user": {"preferenceMatrix": matrix.tolist(), "observationCount": n},
    }
    if primary == "LINUCB":
        body["bandit"] = {"alpha": ALPHA, "ridge": RIDGE, "state": state}
    res = client.post("/v1/place", json=body)
    if res.status_code != 200:
        raise RuntimeError(res.text)
    result = res.json()["results"][0]
    return result if result["outcome"] == "PLACED" else None


# --- Behaviour ----------------------------------------------------------------


@dataclass
class Outcome:
    done: int = 0  # tasks the student started (after any move)
    starts: int = 0  # unmoved starts: START events
    moves: int = 0
    infeasible: int = 0
    tasks: int = 0


def _react(
    student: Student, task: Task, start: int
) -> tuple[bool, str | None, float | None, int]:
    """What the student does with a block at ``start``.

    Returns (done, signal, reward, new_start). ``signal`` is "START", "MOVE" or None.
    """
    midnight = (start // DAY_MS) * DAY_MS
    days_left = (task.deadline_ms - start) / DAY_MS
    p = open_chance(student, days_left)
    if in_band(student, start, midnight):
        if task.u_open < p:
            return True, "START", 1.0, start
        return False, None, None, start  # block ignored: no signal
    if task.u_drag < student.drag:
        moved = band_centre_ms(student, midnight, task.duration_min)
        drag = abs(moved - start) / MS_PER_MINUTE
        done = task.u_open < p
        return done, "MOVE", drag_distance_reward(drag), moved
    return False, None, None, start


def band_prior_matrix(student: Student) -> Any:
    """The H1 map: 1.0 for every weekday hour in the stated band, 0.2 outside it."""
    m = default_preference_matrix() * 0.0
    for wd in range(1, 8):
        for h in range(24):
            m[matrix_index(wd, h)] = (
                1.0 if student.band[0] <= h < student.band[1] else 0.2
            )
    return m


def simulate(
    student: Student, tasks: list[Task], arm: str, seed: int, client: TestClient
) -> Outcome:
    out = Outcome(tasks=len(tasks))
    rng = random.Random(f"{seed}:{student.name}:{arm}")
    state: dict[str, dict[str, list[float]]] = {a: {"A": [], "b": []} for a in ARM_IDS}
    matrix = band_prior_matrix(student) if arm == "H1" else default_preference_matrix()

    for n, task in enumerate(tasks):
        student_now = student.at(task.arrival_ms)
        if arm in ("H0", "H1", "L0"):
            primary = "LINUCB" if arm == "L0" else "HEURISTIC"
            res = _place(client, task, primary, state, matrix, n)
            if res is None:
                out.infeasible += 1
                continue
            lin = res.get("linucb") if res.get("appliedPolicy") == "LINUCB" else None
            start = lin["startMs"] if lin else res["startMs"]
        elif arm == "Oracle":
            midnight = (task.arrival_ms // DAY_MS) * DAY_MS
            start = band_centre_ms(student_now, midnight, task.duration_min)
            lin = None
        else:  # Rand: a day in the window, a start hour between 08:00 and 22:00
            days_avail = max(1, (task.deadline_ms - task.arrival_ms) // DAY_MS)
            day = rng.randrange(int(days_avail))
            hour = rng.randrange(8, 22)
            start = (task.arrival_ms // DAY_MS) * DAY_MS + day * DAY_MS + hour * HOUR_MS
            lin = None

        done, signal, reward, new_start = _react(student_now, task, start)
        if done:
            out.done += 1
        if signal == "START":
            out.starts += 1
        if signal == "MOVE":
            out.moves += 1

        if signal is not None:
            if signal == "START":
                matrix = reinforce_preference_cell(
                    matrix, start, "UTC", PREFERENCE_KEPT_WEIGHT
                )
            else:
                drag_min = abs(new_start - start) / MS_PER_MINUTE
                matrix = reinforce_preference_move(
                    matrix, start, new_start, "UTC", drag_min
                )
            if lin is not None and reward is not None:
                arm_id = lin["selectedArm"]
                upd = client.post(
                    "/v1/update",
                    json={
                        "ridge": RIDGE,
                        "arm": arm_id,
                        "x": lin["featureVector"],
                        "reward": reward,
                        "state": state[arm_id],
                    },
                )
                if upd.status_code != 200:
                    raise RuntimeError(upd.text)
                state[arm_id] = upd.json()
    return out


# --- Statistics ---------------------------------------------------------------


def bootstrap_ci(
    values: list[float], reps: int = 2000, seed: int = 0
) -> tuple[float, float, float]:
    """Mean and a 95% percentile bootstrap interval over students."""
    rng = random.Random(seed)
    n = len(values)
    means = sorted(statistics.fmean(rng.choices(values, k=n)) for _ in range(reps))
    return statistics.fmean(values), means[int(0.025 * reps)], means[int(0.975 * reps)]


def worst_decile_mean(diffs: list[float]) -> float:
    ordered = sorted(diffs)
    k = max(1, len(ordered) // 10)
    return statistics.fmean(ordered[:k])


# --- Grid ---------------------------------------------------------------------

BANDS = {
    "day_9_17": (9, 17),  # the default map's band, so H0 starts near its ceiling
    "morning_6_10": (6, 10),
    "afternoon_13_17": (13, 17),
    "evening_17_21": (17, 21),
    "night_21_24": (21, 24),
}


def worlds() -> dict[str, Student]:
    """Band grid at mid engagement, then an attention sweep on the evening band."""
    grid: dict[str, Student] = {}
    for name, band in BANDS.items():
        grid[f"band_{name}"] = Student(name, band, 0.5, 0.5, 0.3)
    for level in (0.05, 0.15, 0.3, 0.6, 0.9):
        grid[f"attention_{level}_evening"] = Student(
            "evening", (17, 21), level, 0.5, 0.3
        )
    grid["absent_evening"] = ARCHETYPES["absent"].with_attention(0.02)
    # Routine changes after two weeks: evening to morning. Tests adaptation.
    grid["shift_evening_to_morning"] = Student(
        "shift",
        (17, 21),
        0.5,
        0.5,
        0.3,
        shift_at_ms=14 * DAY_MS,
        band_after=(6, 10),
    )
    return grid


def _seed_worker(args: tuple[int, int, int, int, tuple[str, ...]]) -> dict[str, Any]:
    """One seed over every world and student: per-arm task counts for each world."""
    seed, students, weeks, tasks_per_week, arms = args
    client = TestClient(app)
    per_arm: dict[str, dict[str, list[int]]] = {
        w: {a: [] for a in arms} for w in worlds()
    }
    infeasible: dict[str, dict[str, int]] = {w: {a: 0 for a in arms} for w in worlds()}
    for world_name, student in worlds().items():
        for idx in range(students):
            rng = random.Random(f"tasks:{seed}:{idx}")
            tasks = make_tasks(rng, weeks, tasks_per_week)
            for arm in arms:
                o = simulate(student, tasks, arm, seed * 100_000 + idx, client)
                per_arm[world_name][arm].append(o.done)
                infeasible[world_name][arm] += o.infeasible
        print(f"seed {seed}: {world_name} done", flush=True)
    return {"seed": seed, "per_arm": per_arm, "infeasible": infeasible}


def run_suite(
    seeds: int,
    students: int,
    weeks: int,
    tasks_per_week: int,
    arms: tuple[str, ...],
    workers: int = 1,
    parts_dir: Path | None = None,
) -> dict[str, Any]:
    """Run each seed in its own process, then merge. Each process writes a part file,
    so a crash loses one seed, not the run."""
    import subprocess
    import sys
    from concurrent.futures import ThreadPoolExecutor

    parts_dir = parts_dir or Path(__file__).parent / "out" / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")

    def launch(seed: int) -> None:
        part = parts_dir / f"seed-{seed:03d}.json"
        if part.exists():
            return
        cmd = [
            sys.executable,
            "-m",
            "evalx",
            "seed",
            "--seed",
            str(seed),
            "--students",
            str(students),
            "--weeks",
            str(weeks),
            "--tasks-per-week",
            str(tasks_per_week),
            "--arms",
            ",".join(arms),
            "--part",
            str(part),
        ]
        subprocess.run(
            cmd,
            check=True,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(launch, range(seeds)))
    chunks = [
        json.loads((parts_dir / f"seed-{i:03d}.json").read_text()) for i in range(seeds)
    ]
    return _merge(chunks, seeds, students, weeks, tasks_per_week, arms)


def _merge(
    chunks: list[dict[str, Any]],
    seeds: int,
    students: int,
    weeks: int,
    tasks_per_week: int,
    arms: tuple[str, ...],
) -> dict[str, Any]:
    results: dict[str, Any] = {
        "config": {
            "seeds": seeds,
            "students": students,
            "weeks": weeks,
            "tasks_per_week": tasks_per_week,
            "arms": list(arms),
            "alpha": ALPHA,
            "ridge": RIDGE,
        },
        "worlds": {},
    }
    for world_name, student in worlds().items():
        per_arm: dict[str, list[int]] = {a: [] for a in arms}
        infeasible = {a: 0 for a in arms}
        for chunk in chunks:
            for arm in arms:
                per_arm[arm].extend(chunk["per_arm"][world_name][arm])
                infeasible[arm] += chunk["infeasible"][world_name][arm]
        tasks_total = seeds * students * weeks * tasks_per_week
        summary: dict[str, Any] = {"student": asdict(student), "arms": {}}
        for arm in arms:
            m, lo, hi = bootstrap_ci(per_arm[arm])
            summary["arms"][arm] = {
                "done_mean": m,
                "ci": [lo, hi],
                "infeasible_share": infeasible[arm] / tasks_total,
            }
        if "H0" in arms and "L0" in arms:
            diffs = [
                lin - heu for lin, heu in zip(per_arm["L0"], per_arm["H0"], strict=True)
            ]
            m, lo, hi = bootstrap_ci(diffs, seed=1)
            summary["L0_minus_H0"] = {
                "mean": m,
                "ci": [lo, hi],
                "share_better": sum(d > 0 for d in diffs) / len(diffs),
                "share_worse": sum(d < 0 for d in diffs) / len(diffs),
                "worst_decile": worst_decile_mean(diffs),
            }
        if "H1" in arms and "L0" in arms:
            diffs_h1 = [
                lin - heu for lin, heu in zip(per_arm["L0"], per_arm["H1"], strict=True)
            ]
            m1, lo1, hi1 = bootstrap_ci(diffs_h1, seed=2)
            summary["L0_minus_H1"] = {"mean": m1, "ci": [lo1, hi1]}
        results["worlds"][world_name] = summary
    return results


def render(results: dict[str, Any]) -> str:
    cfg = results["config"]
    lines = [
        "# Eval: heuristic vs LinUCB (stage 2)",
        "",
        f"Students per world per seed: {cfg['students']}; seeds: {cfg['seeds']}; "
        f"{cfg['weeks']} weeks, {cfg['tasks_per_week']} tasks per week. "
        "Values are tasks started per student over the period. CIs are 95% bootstrap "
        "intervals over students.",
        "",
        "| World | H0 default map | H1 band map | LinUCB (L0) | Rand | Oracle "
        "| L0 − H0 [95% CI] | L0 − H1 [95% CI] | Better / worse vs H0 "
        "| Worst decile vs H0 |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, w in results["worlds"].items():
        a = w["arms"]
        d = w.get("L0_minus_H0")
        diff = f"{d['mean']:+.2f} [{d['ci'][0]:+.2f}, {d['ci'][1]:+.2f}]" if d else "-"
        better = f"{d['share_better']:.0%} / {d['share_worse']:.0%}" if d else "-"
        worst = f"{d['worst_decile']:+.2f}" if d else "-"
        d1 = w.get("L0_minus_H1")
        diff1 = (
            f"{d1['mean']:+.2f} [{d1['ci'][0]:+.2f}, {d1['ci'][1]:+.2f}]" if d1 else "-"
        )
        lines.append(
            f"| {name} | {a['H0']['done_mean']:.2f} | {a['H1']['done_mean']:.2f} "
            f"| {a['L0']['done_mean']:.2f} | {a['Rand']['done_mean']:.2f} "
            f"| {a['Oracle']['done_mean']:.2f} | {diff} | {diff1} "
            f"| {better} | {worst} |"
        )
    lines += [
        "",
        "## Limits",
        "",
        "- Tasks do not crowd each other: each task is placed on an empty calendar.",
        "- Student traits are assumptions. The worlds vary them; "
        "no calibration data exists yet.",
        "- Only the attention sweep varies engagement. "
        "Notification responses are not modelled.",
        "- START only counts when the student does not move the block first, "
        "as in production.",
        "- H1 assumes the stated band is right. "
        "Its gap to H0 is the value of knowing the band.",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="evalx")
    sub = ap.add_subparsers(dest="cmd", required=True)
    one = sub.add_parser("seed", help="run one seed and write its part file")
    one.add_argument("--seed", type=int, required=True)
    one.add_argument("--students", type=int, required=True)
    one.add_argument("--weeks", type=int, required=True)
    one.add_argument("--tasks-per-week", type=int, required=True)
    one.add_argument("--arms", required=True)
    one.add_argument("--part", type=Path, required=True)
    run = sub.add_parser(
        "run", help="run the grid and write results.json and report.md"
    )
    run.add_argument("--seeds", type=int, default=2)
    run.add_argument("--students", type=int, default=120)
    run.add_argument("--weeks", type=int, default=4)
    run.add_argument("--tasks-per-week", type=int, default=3)
    run.add_argument("--arms", default=",".join(ARMS))
    run.add_argument("--workers", type=int, default=1)
    run.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = ap.parse_args(argv)

    if args.cmd == "seed":
        arms = tuple(a.strip() for a in args.arms.split(",") if a.strip())
        chunk = _seed_worker(
            (args.seed, args.students, args.weeks, args.tasks_per_week, arms)
        )
        args.part.parent.mkdir(parents=True, exist_ok=True)
        args.part.write_text(json.dumps(chunk))
        return 0

    arms = tuple(a.strip() for a in args.arms.split(",") if a.strip())
    results = run_suite(
        args.seeds,
        args.students,
        args.weeks,
        args.tasks_per_week,
        arms,
        workers=args.workers,
    )
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (args.out / "report.md").write_text(render(results))
    print(render(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
