"""CLI: ``python -m src.simulation.run --seed N [--alpha-sweep] [--students N]``.

Runs every student's paired worlds (multiprocessing over students), builds the
scenario x policy report and writes ``report.md`` + ``report.json`` to
``<out-dir>/seed-N[-sweep]/``. The report is a pure function of the config and
the source, so the same seed reproduces it byte for byte; the result cache
(``.sim_cache/``) skips the run when config and code are unchanged. Wall-clock
time is printed to stderr and never written into the report.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts

from . import cache
from .archetypes import LAZY_INTERACTION_MIX
from .engine import SimConfig, StudentResult, run_student
from .metrics import build_report
from .render import render_markdown
from .sweep import DEFAULT_ALPHAS
from .world import SCENARIO_BY_NAME

DEFAULT_OUT_DIR = cache.DEFAULT_CACHE_DIR.parent / "sim_out"


def _parse_interaction_mix(s: str) -> dict[str, float]:
    """Parse ``dragger=0.2,tapper=0.5,ignorer=0.3``."""
    out: dict[str, float] = {}
    for part in s.split(","):
        k, _, v = part.partition("=")
        out[k.strip()] = float(v.strip())
    return out


Cohort = dict[str, tuple[NDArray[np.float64], NDArray[np.float64], int]]


def _run_one(
    args: tuple[SimConfig, int] | tuple[SimConfig, int, Cohort | None],
) -> StudentResult:
    cfg, student_id, *rest = args
    return run_student(cfg, student_id, rest[0] if rest else None)


def _map(
    jobs: list[tuple[SimConfig, int, Cohort | None]], workers: int
) -> list[StudentResult]:
    if workers <= 1:
        return [_run_one(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_run_one, jobs, chunksize=1))


def _pooled(results: list[StudentResult]) -> Cohort:
    """Shared-beta statistics summed over every student, per ``scenario|label``."""
    total: Cohort = {}
    for r in results:
        for key, (a, b, n) in r.shared.items():
            if key in total:
                ta, tb, tn = total[key]
                total[key] = (ta + a, tb + b, tn + n)
            else:
                total[key] = (a, b, n)
    return total


def _others(total: Cohort, own: StudentResult) -> Cohort:
    """The pool minus one student's own statistics (leave-one-out)."""
    out: Cohort = {}
    for key, (ta, tb, tn) in total.items():
        a, b, n = own.shared.get(key, (np.zeros_like(ta), np.zeros_like(tb), 0))
        out[key] = (ta - a, tb - b, tn - n)
    return out


def run_students(cfg: SimConfig, workers: int = 1) -> list[StudentResult]:
    """Every student. With ``cfg.cohort`` the students run twice: once alone to
    pool the shared-beta statistics, then each one warm-started from the others."""
    results = _map([(cfg, sid, None) for sid in range(cfg.n_students)], workers)
    if not cfg.cohort:
        return results
    total = _pooled(results)
    return _map([(cfg, r.student_id, _others(total, r)) for r in results], workers)


def run(
    cfg: SimConfig,
    workers: int = 1,
    use_cache: bool = True,
    cache_dir: Path = cache.DEFAULT_CACHE_DIR,
) -> tuple[dict[str, object], bool]:
    """Report for ``cfg`` and whether it came from the cache."""
    key = cache.cache_key(cfg)
    if use_cache:
        hit = cache.load(key, cache_dir)
        if hit is not None:
            return hit, True
    report = build_report(cfg, run_students(cfg, workers))
    if use_cache:
        cache.store(key, report, cache_dir)
    return report, False


def write_report(report: dict[str, object], out: Path) -> tuple[Path, Path]:
    out.mkdir(parents=True, exist_ok=True)
    js, md = out / "report.json", out / "report.md"
    js.write_text(cache.dumps(report), encoding="utf-8", newline="\n")
    md.write_text(render_markdown(report), encoding="utf-8", newline="\n")
    return md, js


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.simulation.run")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--students", type=int, default=SimConfig.n_students)
    ap.add_argument("--events", type=int, default=SimConfig.n_events)
    ap.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 1))
    ap.add_argument("--alpha-sweep", action="store_true", help="sweep BANDIT_ALPHA")
    ap.add_argument("--alphas", type=float, nargs="+", help="explicit alpha list")
    ap.add_argument("--scenarios", nargs="+", choices=sorted(SCENARIO_BY_NAME))
    ap.add_argument(
        "--interaction-mix",
        type=_parse_interaction_mix,
        help="comma-separated shares: dragger=0.2,tapper=0.5,ignorer=0.3",
    )
    ap.add_argument(
        "--profile",
        choices=("legacy", "lazy"),
        help="legacy: drag-only students; lazy: few drags, more taps and ignores",
    )
    ap.add_argument(
        "--linucb",
        choices=("v1", "v2"),
        help="hour inside a band: v1 preference matrix, v2 gap quality (default)",
    )
    ap.add_argument(
        "--no-hybrid", action="store_true", help="v2 without the shared beta (ablation)"
    )
    ap.add_argument(
        "--no-deadline-penalty",
        action="store_true",
        help="disable the deadline-pressure penalty (ablation)",
    )
    ap.add_argument(
        "--weak-effect",
        type=float,
        help="hypothesis: weak students start earlier, strength (0 = no effect)",
    )
    ap.add_argument(
        "--cohort",
        action="store_true",
        help="warm-start shared beta from the other students (two passes)",
    )
    ap.add_argument("--reward", choices=("completion", "retained"))
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    a = ap.parse_args(argv)
    if a.profile and a.interaction_mix:
        ap.error("--profile and --interaction-mix are mutually exclusive")

    cfg = SimConfig(seed=a.seed, n_students=a.students, n_events=a.events)
    kwargs: dict[str, object] = {}
    if a.scenarios:
        kwargs["scenarios"] = tuple(a.scenarios)
    if a.alphas:
        kwargs["alphas"] = tuple(a.alphas)
    elif a.alpha_sweep:
        kwargs["alphas"] = tuple(DEFAULT_ALPHAS)
    if a.interaction_mix:
        kwargs["interaction_mix"] = a.interaction_mix
    elif a.profile == "lazy":
        kwargs["interaction_mix"] = dict(LAZY_INTERACTION_MIX)
    if a.linucb == "v1":
        kwargs["pref_weight"] = consts.LINUCB_PREF_WEIGHT
        kwargs["gap_weight"] = 0.0
        kwargs["hybrid"] = False
    if a.no_hybrid:
        kwargs["hybrid"] = False
    if a.no_deadline_penalty:
        kwargs["deadline_weight"] = 0.0
    if a.cohort:
        kwargs["cohort"] = True
    if a.weak_effect is not None:
        kwargs["weak_effect"] = a.weak_effect
    if a.reward:
        kwargs["reward"] = a.reward
    if kwargs:
        cfg = replace(cfg, **kwargs)

    t0 = time.perf_counter()
    report, hit = run(cfg, a.workers, use_cache=not a.no_cache)
    elapsed = time.perf_counter() - t0
    out = a.out_dir / f"seed-{cfg.seed}{'-sweep' if len(cfg.alphas) > 1 else ''}"
    md, js = write_report(report, out)
    print(f"report: {md}\njson:   {js}")
    print(
        f"{'cache hit' if hit else 'ran'} in {elapsed:.1f}s "
        f"({cfg.n_students} students, {a.workers} workers)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
