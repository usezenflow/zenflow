"""Figures for the eval report, drawn from results.json and sensitivity.json.

Run:  uv run python -m evalx.figures [--out evalx/out]
F1 S minus H1 by world, F2 ablation, F3 sensitivity to student behaviour and constants.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
COLOURS = {"correct": "#2a78d6", "wrong": "#eb6834", "stale": "#52514e"}
LABELS = {
    "correct": "Stated band correct",
    "wrong": "Stated band wrong",
    "stale": "Routine changed",
}
DELTA = 0.5


def _style(ax: Any) -> None:
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.grid(axis="x", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def _legend(ax: Any, groups: list[str]) -> None:
    handles = [
        plt.Line2D([], [], marker="o", color=COLOURS[g], label=LABELS[g], ls="")
        for g in groups
    ]
    ax.legend(handles=handles, frameon=False, fontsize=8, labelcolor=MUTED)


def _save(fig: Any, path: Path) -> None:
    fig.patch.set_facecolor(SURFACE)
    fig.tight_layout()
    fig.savefig(path, dpi=160, facecolor=SURFACE)
    plt.close(fig)


def _point(ax: Any, y: float, c: dict[str, float], colour: str) -> None:
    ax.plot([c["ci_lo"], c["ci_hi"]], [y, y], color=colour, lw=1, alpha=0.5)
    ax.plot([c["seed_lo"], c["seed_hi"]], [y, y], color=colour, lw=3)
    ax.plot(c["mean"], y, "o", color=colour, ms=5, mec=SURFACE, mew=1.5)


def forest(res: dict[str, Any], out: Path) -> None:
    names = list(res["worlds"])
    fig, ax = plt.subplots(figsize=(8, 0.28 * len(names) + 1.2))
    for i, name in enumerate(names):
        c = res["worlds"][name]["contrasts"]["S_minus_H1"]
        _point(ax, i, c, COLOURS[name.rsplit("/", 1)[1]])
    ax.axvline(0, color=INK, lw=0.8)
    ax.axvline(-DELTA, color=MUTED, lw=0.8, ls="--")
    ax.set_yticks(range(len(names)), [n.replace("_", " ") for n in names])
    ax.invert_yaxis()
    ax.set_xlabel("Starts per student, S minus H1 (thin: students, thick: seeds)")
    ax.set_title(
        "LinUCB against a heuristic with the same band", loc="left", fontsize=10
    )
    ax.text(-DELTA, len(names) - 0.3, "margin", color=MUTED, fontsize=7, ha="center")
    _style(ax)
    _legend(ax, ["correct", "wrong", "stale"])
    _save(fig, out / "f1-by-world.png")


def ablation(res: dict[str, Any], out: Path) -> None:
    parts = [
        ("prior", "Band prior"),
        ("gap", "Gap quality"),
        ("deadline", "Deadline term"),
        ("tiebreak", "Seeded tie-break"),
    ]
    fig, ax = plt.subplots(figsize=(7, 3.2))
    for i, (key, _) in enumerate(parts):
        for name, w in res["worlds"].items():
            group = name.rsplit("/", 1)[1]
            if not name.startswith("band_"):
                continue
            c = w["contrasts"][key]["mean"]
            ax.plot(
                c, i, "o", color=COLOURS[group], ms=6, mec=SURFACE, mew=1.2, alpha=0.9
            )
    ax.axvline(0, color=INK, lw=0.8)
    ax.set_yticks(range(len(parts)), [label for _, label in parts])
    ax.invert_yaxis()
    ax.set_xlabel(
        "Starts per student, S minus S without the part (one dot per band world)"
    )
    ax.set_title("What each part of LinUCB adds", loc="left", fontsize=10)
    _style(ax)
    _legend(ax, ["correct", "wrong"])
    _save(fig, out / "f2-ablation.png")


def sensitivity(rows: dict[str, Any], out: Path) -> None:
    names = list(rows)
    fig, (a, b) = plt.subplots(1, 2, figsize=(9, 0.5 * len(names) + 1.2), sharey=True)
    for i, name in enumerate(names):
        for j, group in enumerate(("correct", "wrong")):
            y = i + (j - 0.5) * 0.3
            _point(a, y, rows[name][group]["S_minus_H1"], COLOURS[group])
            p = rows[name][group]["pick_linucb"]
            if p["rate"] != p["rate"]:
                continue
            b.plot([p["ci_lo"], p["ci_hi"]], [y, y], color=COLOURS[group], lw=3)
            b.plot(p["rate"], y, "o", color=COLOURS[group], ms=5, mec=SURFACE, mew=1.5)
    a.axvline(0, color=INK, lw=0.8)
    b.axvline(0.5, color=INK, lw=0.8)
    a.set_yticks(range(len(names)), names)
    a.invert_yaxis()
    a.set_xlabel("Starts per student, S minus H1")
    b.set_xlabel("Share of taps that pick LinUCB's option")
    a.set_title("Effect on starts", loc="left", fontsize=10)
    b.set_title("Pairwise pick rate", loc="left", fontsize=10)
    for ax in (a, b):
        _style(ax)
    _legend(a, ["correct", "wrong"])
    _save(fig, out / "f3-sensitivity.png")


def main() -> int:
    ap = argparse.ArgumentParser(prog="evalx.figures")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = ap.parse_args()
    res = json.loads((args.out / "results.json").read_text())
    forest(res, args.out)
    ablation(res, args.out)
    sens = args.out / "sensitivity.json"
    if sens.exists():
        sensitivity(json.loads(sens.read_text()), args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
