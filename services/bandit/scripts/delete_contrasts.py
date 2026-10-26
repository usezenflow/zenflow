"""Paired delete-scoring contrasts from `evalx run` outputs (ADR-0043).

Usage: python scripts/delete_contrasts.py <dir with delete-noise-<level>/ runs>

Reads each run's per-seed parts, computes every student's adherence (a deleted
or unplaced task counts as not started), and prints one table per noise level.
Intervals resample students; p-values are sign-flip tests, Holm-adjusted per table.
"""

from __future__ import annotations

import glob
import json
import sys
from pathlib import Path

import numpy as np

from evalx import metrics

LEVELS = ("0", "0.1", "0.2", "0.3")
CONTRASTS = [
    ("L+D-0.1 vs L", "L+D-0.1", "L"),
    ("L+D-0.25 vs L", "L+D-0.25", "L"),
    ("L+D-0.5 vs L", "L+D-0.5", "L"),
    ("H+M-0.03125 vs H", "H+M-0.03125", "H"),
    ("H+M-0.0625 vs H", "H+M-0.0625", "H"),
    ("H+M-0.125 vs H", "H+M-0.125", "H"),
    ("H+K+M-0.03125 vs H+K", "H+K+M-0.03125", "H+K"),
    ("H+K+M-0.0625 vs H+K", "H+K+M-0.0625", "H+K"),
    ("H+K+M-0.125 vs H+K", "H+K+M-0.125", "H+K"),
    ("L vs H (no delete learning)", "L", "H"),
]


def seed_of(path: str) -> int:
    return int(Path(path).stem.removeprefix("seed-"))


def per_student(run: Path) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], int]:
    """Per-student done rate and delete rate, in percent, for each arm."""
    files = sorted(glob.glob(str(run / "parts" / "*" / "seed-*.json")), key=seed_of)
    done: dict[str, list[float]] = {}
    deleted: dict[str, list[float]] = {}
    for f in files:
        for student in json.loads(Path(f).read_text())["students"]:
            for arm, rows in student["arms"].items():
                done.setdefault(arm, []).append(np.mean([r["s"] or 0.0 for r in rows]))
                deleted.setdefault(arm, []).append(
                    np.mean([r.get("del") or 0.0 for r in rows])
                )
    to_pct = lambda d: {arm: np.array(v) * 100 for arm, v in d.items()}  # noqa: E731
    return to_pct(done), to_pct(deleted), len(files)


def main(root: Path) -> None:
    for level in LEVELS:
        done, deleted, seeds = per_student(root / f"delete-noise-{level}")
        print(f"\n### p_noise {level}: {seeds} seeds, {len(done['L'])} students\n")
        print("| Arm | Adherence | Deleted before start |")
        print("|---|---|---|")
        for arm in ("H", "H+K", "L", "L+D-0.25", "H+M-0.0625", "H+K+M-0.0625"):
            print(f"| {arm} | {done[arm].mean():.2f}% | {deleted[arm].mean():.2f}% |")
        print()
        results = [
            (label, metrics.contrast(done[a] - done[b], seeds))
            for label, a, b in CONTRASTS
        ]
        adjusted = metrics.holm([c["p"] for _, c in results])
        print("| Contrast | Points [CI over students] | Better / worse | p Holm |")
        print("|---|---|---|---|")
        for (label, c), p in zip(results, adjusted, strict=True):
            print(
                f"| {label} | {c['mean']:+.2f} [{c['ci_lo']:+.2f}, {c['ci_hi']:+.2f}] "
                f"| {c['share_better']:.0%} / {c['share_worse']:.0%} | {p:.3f} |"
            )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
