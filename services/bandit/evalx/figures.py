"""Figures for the eval report, from results, sensitivity and deadline json.

Run:  uv run python -m evalx.figures [--out evalx/out]
Semester results (``arms`` in results.json), 300 DPI:
  F1 cumulative regret against the Oracle, F2 weekly adherence,
  F3 hours before the deadline per student, F4 adherence over the first tasks.
Fixed world results (``worlds``): F1 L minus H by world, F2 every arm by world,
and, when their json exists, F3 sensitivity and F4 starts against deadline distance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
COLOURS = {
    "band": "#2a78d6",
    "weekend": "#1baf7a",
    "attention": "#eb6834",
    "other": "#52514e",
}
LABELS = {
    "band": "True band",
    "weekend": "Weekend differs",
    "attention": "Attention sweep",
    "other": "Absent or routine change",
}
DELTA = 0.5


def _group(name: str) -> str:
    if name.startswith("band_"):
        return "band"
    if name.startswith("weekend"):
        return "weekend"
    if name.startswith("attention"):
        return "attention"
    return "other"


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
        Line2D([], [], marker="o", color=COLOURS[g], label=LABELS[g], ls="")
        for g in groups
    ]
    ax.legend(handles=handles, frameon=False, fontsize=8, labelcolor=MUTED)


def _save(fig: Any, path: Path, dpi: int = 160) -> None:
    fig.patch.set_facecolor(SURFACE)
    fig.tight_layout()
    fig.savefig(path, dpi=dpi, facecolor=SURFACE)
    plt.close(fig)


def _point(ax: Any, y: float, c: dict[str, float], colour: str) -> None:
    ax.plot([c["ci_lo"], c["ci_hi"]], [y, y], color=colour, lw=1, alpha=0.5)
    ax.plot([c["seed_lo"], c["seed_hi"]], [y, y], color=colour, lw=3)
    ax.plot(c["mean"], y, "o", color=colour, ms=5, mec=SURFACE, mew=1.5)


def _names(res: dict[str, Any]) -> list[str]:
    return [n.replace("_", " ") for n in res["worlds"]]


def forest(res: dict[str, Any], out: Path) -> None:
    worlds = list(res["worlds"])
    fig, ax = plt.subplots(figsize=(8, 0.28 * len(worlds) + 1.2))
    for i, name in enumerate(worlds):
        c = res["worlds"][name]["contrasts"]["L_minus_H"]
        _point(ax, i, c, COLOURS[_group(name)])
    ax.axvline(0, color=INK, lw=0.8)
    ax.axvline(-DELTA, color=MUTED, lw=0.8, ls="--")
    ax.set_yticks(range(len(worlds)), _names(res))
    ax.invert_yaxis()
    ax.set_xlabel("Starts per student, L minus H (thin: students, thick: seeds)")
    ax.set_title(
        "Matrix seeded LinUCB against the default heuristic", loc="left", fontsize=10
    )
    ax.text(-DELTA, len(worlds) - 0.3, "margin", color=MUTED, fontsize=7, ha="center")
    _style(ax)
    _legend(ax, list(LABELS))
    _save(fig, out / "f1-by-world.png")


ARM_COLOURS = {
    "H": "#1baf7a",
    "L-cold": "#e87ba4",
    "L": "#2a78d6",
}


def arms(res: dict[str, Any], out: Path) -> None:
    worlds = list(res["worlds"])
    fig, ax = plt.subplots(figsize=(8, 0.28 * len(worlds) + 1.4))
    for i, name in enumerate(worlds):
        a = res["worlds"][name]["arms"]
        ax.plot(
            [a["Rand"]["mean"], a["Oracle"]["mean"]], [i, i], color=GRID, lw=6, zorder=1
        )
        for arm, colour in ARM_COLOURS.items():
            ax.plot(
                a[arm]["mean"], i, "o", color=colour, ms=5, mec=SURFACE, mew=1, zorder=3
            )
    ax.set_yticks(range(len(worlds)), _names(res))
    ax.invert_yaxis()
    ax.set_xlabel("Starts per student (grey bar: from Rand to Oracle)")
    ax.set_title("Every policy, by world", loc="left", fontsize=10)
    _style(ax)
    handles = [
        Line2D([], [], marker="o", color=c, label=a, ls="")
        for a, c in ARM_COLOURS.items()
    ]
    ax.legend(
        handles=handles, frameon=False, fontsize=8, labelcolor=MUTED, loc="lower right"
    )
    _save(fig, out / "f2-arms.png")


def sensitivity(rows: dict[str, Any], out: Path) -> None:
    names = list(rows)
    fig, (a, b) = plt.subplots(1, 2, figsize=(9, 0.4 * len(names) + 1.2), sharey=True)
    for i, name in enumerate(names):
        _point(a, i, rows[name]["L_minus_H"], COLOURS["band"])
        p = rows[name]["pick_linucb"]
        if p["rate"] != p["rate"]:
            continue
        b.plot([p["ci_lo"], p["ci_hi"]], [i, i], color=COLOURS["band"], lw=3)
        b.plot(p["rate"], i, "o", color=COLOURS["band"], ms=5, mec=SURFACE, mew=1.5)
    a.axvline(0, color=INK, lw=0.8)
    b.axvline(0.5, color=INK, lw=0.8)
    a.set_yticks(range(len(names)), names)
    a.invert_yaxis()
    a.set_xlabel("Starts per student, L minus H")
    b.set_xlabel("Pick rate: share of answered offers that chose LinUCB's slot")
    a.set_title("Effect on starts", loc="left", fontsize=10)
    b.set_title("Pairwise pick rate", loc="left", fontsize=10)
    for ax in (a, b):
        _style(ax)
    _save(fig, out / "f3-sensitivity.png")


def deadline(rows: dict[str, Any], out: Path) -> None:
    fig, ax = plt.subplots(figsize=(7, 4.5))
    for label, r in rows.items():
        x, y = 100 * r["L"]["within_24h"], r["L"]["mean"]
        ax.plot(x, y, "o", color=COLOURS["band"], ms=6, mec=SURFACE, mew=1.5)
        ax.annotate(
            label,
            (x, y),
            textcoords="offset points",
            xytext=(5, 4),
            fontsize=7,
            color=MUTED,
        )
    h0 = next(iter(rows.values()))["H"]["mean"]
    ax.axhline(h0, color=MUTED, lw=0.8, ls="--")
    ax.text(ax.get_xlim()[1], h0, "H", color=MUTED, fontsize=7, va="bottom", ha="right")
    ax.set_xlabel(
        "Blocks ending within 24 hours of the deadline, % (windows of 3 days or more)"
    )
    ax.set_ylabel("L starts per student")
    ax.set_title("Starts against deadline distance", loc="left", fontsize=10)
    _style(ax)
    _save(fig, out / "f4-deadline.png")


SEMESTER_COLOURS = {
    "H": "#1baf7a",
    "L": "#2a78d6",
    "L-cold": "#e87ba4",
    "Fixed": "#eb6834",
    "Rand": "#52514e",
    "Oracle": "#0b0b0b",
    "AB": "#8f6be0",
    "L-hourly-K": "#d4a017",
    "L-hourly-K+N": "#c0392b",
}
PAPER_DPI = 300


def _lines(ax: Any, series: dict[str, list[float]], x0: int = 1) -> None:
    for arm, ys in series.items():
        if arm not in SEMESTER_COLOURS:
            continue  # ablations stay in the tables
        xs = range(x0, x0 + len(ys))
        ax.plot(xs, ys, color=SEMESTER_COLOURS[arm], lw=1.6, label=arm)
    ax.legend(
        frameon=False,
        fontsize=8,
        labelcolor=MUTED,
        loc="center left",
        bbox_to_anchor=(1.01, 0.5),
    )


def semester_regret(res: dict[str, Any], out: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    _lines(ax, res["regret"])
    ax.set_xlabel("Task index")
    ax.set_ylabel("Cumulative regret per student")
    ax.set_title("Regret against the Oracle", loc="left", fontsize=10)
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    _save(fig, out / "f1-regret.png", PAPER_DPI)


def semester_weekly(res: dict[str, Any], out: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    series = {
        a: [100 * v for v in w] for a, w in res["weekly"].items() if a != "Oracle"
    }
    _lines(ax, series)
    for lo, hi, label in ((7, 8, "Midterms"), (14, 15, "Finals")):
        ax.axvspan(lo - 0.5, hi + 0.5, color=GRID, alpha=0.6, zorder=0)
        ax.text(
            (lo + hi) / 2, 0.03, label, transform=ax.get_xaxis_transform(),
            ha="center", va="bottom", fontsize=7, color=MUTED,
        )  # fmt: skip
    ax.set_xlabel("Week of the deadline")
    ax.set_ylabel("Tasks started, %")
    ax.set_title("Adherence by week", loc="left", fontsize=10)
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    _save(fig, out / "f2-weekly.png", PAPER_DPI)


def semester_margin(res: dict[str, Any], out: Path) -> None:
    arms_ = [a for a in ("H", "L", "Fixed", "Rand") if a in res["dist"]]
    data = [[x for x in res["dist"][a]["margin_h"] if x is not None] for a in arms_]
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    parts = ax.violinplot(data, showmedians=True, showextrema=False)
    for body, arm in zip(parts["bodies"], arms_, strict=True):
        body.set_facecolor(SEMESTER_COLOURS[arm])
        body.set_alpha(0.55)
    parts["cmedians"].set_color(INK)
    ax.set_xticks(range(1, len(arms_) + 1), arms_)
    ax.set_ylabel("Mean hours before the deadline, per student")
    ax.set_title("Distance to the deadline", loc="left", fontsize=10)
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    _save(fig, out / "f3-margin.png", PAPER_DPI)


def semester_learning(res: dict[str, Any], out: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    series = {
        a: [100 * v for v in c] for a, c in res["learning"].items() if a != "Oracle"
    }
    _lines(ax, series)
    ax.set_xlabel("Task index")
    ax.set_ylabel("Tasks started, %")
    ax.set_title("Adherence over the first tasks", loc="left", fontsize=10)
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    _save(fig, out / "f4-learning.png", PAPER_DPI)


# Paper arms, in fixed slot order. Each arm keeps its hue wherever it appears.
# Order passes the light-mode CVD and normal-vision gates (validate_palette.js).
PAPER_ARMS = (
    ("L", "L24N (production)", "#2a78d6"),
    ("H", "H", "#1baf7a"),
    ("H+K", "H+K", "#eb6834"),
    ("L-hourly-K", "L24K", "#6250d6"),
    ("L-hourly", "L24", "#e87ba4"),
)
PAPER_BOUNDS = (("Oracle", "Oracle", INK), ("Rand", "Rand", MUTED))


def paper_learning(res: dict[str, Any], out: Path, tasks: int = 30) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    for arm, label, colour in PAPER_ARMS:
        ys = [100 * v for v in res["learning"][arm][:tasks]]
        ax.plot(range(1, tasks + 1), ys, color=colour, lw=1.8, label=label)
    for arm, label, colour in PAPER_BOUNDS:
        ys = [100 * v for v in res["learning"][arm][:tasks]]
        ax.plot(range(1, tasks + 1), ys, color=colour, lw=1.2, ls="--", label=label)
    ax.set_xlabel("Task index")
    ax.set_ylabel("Tasks started, %")
    ax.set_title("Adherence over the first tasks", loc="left", fontsize=10)
    ax.legend(
        frameon=False, fontsize=8, labelcolor=MUTED, loc="center left",
        bbox_to_anchor=(1.01, 0.5),
    )  # fmt: skip
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    _save(fig, out / "learning-curve.png", PAPER_DPI)


def paper_regret(res: dict[str, Any], out: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    for arm, label, colour in PAPER_ARMS:
        ax.plot(range(1, len(res["regret"][arm]) + 1), res["regret"][arm],
                color=colour, lw=1.8, label=label)  # fmt: skip
    arm, label, colour = ("Rand", "Rand", MUTED)
    ax.plot(range(1, len(res["regret"][arm]) + 1), res["regret"][arm],
            color=colour, lw=1.2, ls="--", label=label)  # fmt: skip
    ax.set_xlabel("Task index")
    ax.set_ylabel("Cumulative regret per student")
    ax.set_title("Regret against the Oracle", loc="left", fontsize=10)
    ax.legend(
        frameon=False, fontsize=8, labelcolor=MUTED, loc="center left",
        bbox_to_anchor=(1.01, 0.5),
    )  # fmt: skip
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    _save(fig, out / "regret-curve.png", PAPER_DPI)


def paper_robustness(rows: dict[str, Any], out: Path) -> None:
    worlds = list(rows)
    fig, ax = plt.subplots(figsize=(8, 0.28 * len(worlds) + 1.2))
    for i, name in enumerate(worlds):
        keys = ("mean", "ci_lo", "ci_hi", "seed_lo", "seed_hi")
        c = {k: 100 * rows[name]["L_minus_HK"][k] for k in keys}
        _point(ax, i, c, PAPER_ARMS[0][2])
    ax.axvline(0, color=INK, lw=0.8)
    ax.set_yticks(range(len(worlds)), worlds)
    ax.invert_yaxis()
    ax.set_xlabel(
        "Adherence points, L24N (production) minus H+K (thin: students, thick: seeds)"
    )
    ax.set_title("Robustness on seeds 700 to 799", loc="left", fontsize=10)
    _style(ax)
    _save(fig, out / "robustness-forest.png", PAPER_DPI)


def paper_figures(run: Path, docs: Path) -> None:
    """The paper's figures, from the held-out ladder and robustness runs."""
    docs.mkdir(parents=True, exist_ok=True)
    ladder = json.loads((run / "ladder-700" / "results.json").read_text())
    rows = json.loads((run / "robust-700" / "reality.json").read_text())
    paper_learning(ladder, docs)
    paper_regret(ladder, docs)
    paper_robustness(rows, docs)


def main() -> int:
    ap = argparse.ArgumentParser(prog="evalx.figures")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    ap.add_argument("--paper", type=Path, help="docs/scheduler/figures for the paper")
    args = ap.parse_args()
    if args.paper:
        paper_figures(args.out, args.paper)
        return 0
    res = json.loads((args.out / "results.json").read_text())
    if "arms" in res:
        semester_regret(res, args.out)
        semester_weekly(res, args.out)
        semester_margin(res, args.out)
        semester_learning(res, args.out)
        return 0
    forest(res, args.out)
    arms(res, args.out)
    sens = args.out / "sensitivity.json"
    if sens.exists():
        sensitivity(json.loads(sens.read_text()), args.out)
    dl = args.out / "deadline.json"
    if dl.exists():
        deadline(json.loads(dl.read_text()), args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
