"""Markdown and LaTeX tables for a semester run, read from ``results.json``.

No simulator state is needed: every number comes from the merged results, so a
report can be regenerated from the file alone.
"""

from __future__ import annotations

from typing import Any

from evalx.academic_calendar import FINAL_WEEKS, MIDTERM_WEEKS
from evalx.semester import ADHERENCE_DELTA, CURVE_TASKS

HEADLINE_ORDER = (
    "H",
    "H-frozen",
    "L",
    "L-cold",
    "L-flat",
    "ASAP",
    "Fixed",
    "Rand",
    "Oracle",
    "AB",
)
CONTRAST_LABELS = {
    "L_minus_H": "L against H",
    "L_minus_Fixed": "L against Fixed",
    "H_minus_Fixed": "H against Fixed",
    "L_minus_ASAP": "L against ASAP",
    "L_minus_Hfrozen": "L against H-frozen",
    "H_minus_Hfrozen": "Learning in H (H against H-frozen)",
    "context": "Context (L against L-flat)",
    "prior": "Prior (L against L-cold)",
    "deadline": "Deadline term in L",
    "deadline_H": "Deadline term in H",
    "gap": "Gap term (L against L-nogap)",
    "gap_only": "Gap term without deadline term",
}


def _pct(c: dict[str, float]) -> str:
    return f"{100 * c['mean']:.1f}% [{100 * c['ci_lo']:.1f}, {100 * c['ci_hi']:.1f}]"


def _pts(c: dict[str, float]) -> str:
    return (
        f"{100 * c['mean']:+.1f} [{100 * c['ci_lo']:+.1f}, {100 * c['ci_hi']:+.1f}] "
        f"/ [{100 * c['seed_lo']:+.1f}, {100 * c['seed_hi']:+.1f}]"
    )


def _hours(c: dict[str, float]) -> str:
    return f"{c['mean']:.1f} [{c['ci_lo']:.1f}, {c['ci_hi']:.1f}]"


def _rate(d: dict[str, float]) -> str:
    if d["rate"] != d["rate"]:
        return "n/a"
    return f"{100 * d['rate']:.0f}% [{100 * d['ci_lo']:.0f}, {100 * d['ci_hi']:.0f}]"


def _p(p: float) -> str:
    return "<0.001" if p < 0.001 else f"{p:.3f}"


def _arms(res: dict[str, Any]) -> list[str]:
    return [a for a in HEADLINE_ORDER if a in res["arms"]]


def _season(weekly: list[float], weeks: tuple[int, ...]) -> float:
    vals = [weekly[w - 1] for w in weeks if weekly[w - 1] == weekly[w - 1]]
    return sum(vals) / len(vals) if vals else float("nan")


def render(res: dict[str, Any]) -> str:
    cfg, man = res["config"], res["manifest"]
    pop = res["population"]
    lines = [
        "# Eval: heuristic vs matrix-seeded LinUCB over a semester",
        "",
        "Simulated students only. Their traits are assumptions, drawn per student.",
        "",
        f"Seeds {cfg['seed_offset']} to {cfg['seed_offset'] + cfg['seeds'] - 1}, "
        f"{pop['students']} students, {cfg['weeks']} weeks, "
        f"{pop['tasks_per_student']:.0f} tasks per student of which "
        f"{pop['exams_per_student']:.1f} exam prep plans. "
        f"Drag {cfg['cfg']['drag']:.2f}. Code `{man['code_sha']}`, "
        f"config `{man['config_hash']}`, {man['generated']}.",
        "",
        "Done rate is the share of tasks the student completed. A task with no "
        "placement counts as not done. Intervals read `mean [95% CI over "
        "students]`.",
        "",
        "## Headline",
        "",
        "| Arm | Done rate | Hours before deadline | Last day share "
        "| Conflict free | Events per student |",
        "|---|---|---|---|---|---|",
    ]
    for arm in _arms(res):
        a = res["arms"][arm]
        lines.append(
            f"| {arm} | {_pct(a['done_rate'])} | {_hours(a['margin_h'])} "
            f"| {100 * a['last_day']['mean']:.0f}% "
            f"| {100 * a['conflict_free']['mean']:.0f}% "
            f"| {a['burden']['mean']:.1f} |"
        )
    lines += [
        "",
        f"Last day share is blocks ending within 24 hours of the deadline, over "
        f"tasks with a window of 3 days or more. Events are starts, offer taps "
        f"and drags. Margin for non inferiority: {100 * ADHERENCE_DELTA:.0f} points.",
        "",
        "## Contrasts",
        "",
        "Adherence difference in points: `mean [CI over students] / [CI over seeds]`. "
        "The p value is a paired sign flip test; Holm adjusts across this table.",
        "",
        "| Contrast | Points | Relative | Students better | Students worse "
        "| p Holm | Verdict | Hours before deadline |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for key, c in res["contrasts"].items():
        m = c["margin_h"]
        lines.append(
            f"| {CONTRAST_LABELS.get(key, key)} | {_pts(c)} "
            f"| {100 * c['rel_lift']:+.0f}% | {100 * c['share_better']:.0f}% "
            f"| {100 * c['share_worse']:.0f}% "
            f"| {_p(c['p_holm'])} | {c['verdict']} "
            f"| {m['mean']:+.1f} [{m['ci_lo']:+.1f}, {m['ci_hi']:+.1f}] |"
        )
    if "groups" in res:
        lines += [
            "",
            "## Who benefits",
            "",
            "L minus H in done-rate points, by student group. Better and worse are "
            "the shares of students whose own done rate is higher or lower under L.",
            "",
            "| Group | Students | Points | Better | Worse |",
            "|---|---|---|---|---|",
        ]
        for name, g in res["groups"].items():
            lines.append(
                f"| {name} | {g['n']} | {100 * g['mean']:+.1f} "
                f"[{100 * g['ci_lo']:+.1f}, {100 * g['ci_hi']:+.1f}] "
                f"| {100 * g['share_better']:.0f}% | {100 * g['share_worse']:.0f}% |"
            )
    lines += [
        "",
        "## By season and kind",
        "",
        "| Arm | Regular | Midterm | Final | Exam prep | Assignment prep |",
        "|---|---|---|---|---|---|",
    ]
    for arm in _arms(res):
        w = res["weekly"][arm]
        regular = tuple(
            x for x in range(1, len(w) + 1) if x not in MIDTERM_WEEKS + FINAL_WEEKS
        )
        k = res["by_kind"][arm]
        lines.append(
            f"| {arm} | {100 * _season(w, regular):.1f}% "
            f"| {100 * _season(w, MIDTERM_WEEKS):.1f}% "
            f"| {100 * _season(w, FINAL_WEEKS):.1f}% "
            f"| {100 * k['exam']:.1f}% | {100 * k['assignment']:.1f}% |"
        )
    if "regret" in res:
        lines += [
            "",
            "## Learning",
            "",
            "Regret is the running sum of the Oracle's start chance minus the arm's, "
            f"per student. Early and late done rate are the first 10 and the "
            f"last of the first {CURVE_TASKS} tasks.",
            "",
            "| Arm | Regret at the last task | Adherence, tasks 1 to 10 "
            f"| Adherence, tasks {CURVE_TASKS - 9} to {CURVE_TASKS} |",
            "|---|---|---|---|",
        ]
        for arm in _arms(res):
            if arm not in res["regret"]:
                continue
            curve = res["learning"][arm]
            early = sum(curve[:10]) / 10
            late = sum(curve[-10:]) / 10
            lines.append(
                f"| {arm} | {res['regret'][arm][-1]:.2f} "
                f"| {100 * early:.1f}% | {100 * late:.1f}% |"
            )
    if "ab" in res:
        a = res["ab"]
        lines += [
            "",
            "## Pairwise offer (live protocol)",
            "",
            "Cluster bootstrap by student. A pick rate of 50% is no preference.",
            "",
            "| Offered | Tapped | LinUCB pick rate | Start, LinUCB primary "
            "| Start, heuristic primary |",
            "|---|---|---|---|---|",
            f"| {_rate(a['offered'])} | {_rate(a['tapped'])} "
            f"| {_rate(a['pick_linucb'])} | {_rate(a['start_linucb_primary'])} "
            f"| {_rate(a['start_heuristic_primary'])} |",
        ]
    lines += [
        "",
        "## Limits",
        "",
        "- Simulated students only; start curves and offer response are not "
        "calibrated.",
        "- Prep tasks follow production sizing; the timetable is one weekly pattern.",
        "- Rewards reach the learner at placement time, not after the block.",
        "- Hybrid LinUCB and series are not in these arms.",
        "- The pick model is assumed until classroom labels exist.",
    ]
    return "\n".join(lines) + "\n"


def render_latex(res: dict[str, Any]) -> str:
    """The headline and contrast tables as LaTeX ``tabular`` blocks."""
    rows = [
        f"{arm} & {100 * res['arms'][arm]['done_rate']['mean']:.1f} "
        f"& {res['arms'][arm]['margin_h']['mean']:.1f} "
        f"& {100 * res['arms'][arm]['conflict_free']['mean']:.0f} \\\\"
        for arm in _arms(res)
    ]
    crows = [
        f"{CONTRAST_LABELS.get(k, k)} & {100 * c['mean']:+.1f} "
        f"& [{100 * c['ci_lo']:+.1f}, {100 * c['ci_hi']:+.1f}] "
        f"& {_p(c['p_holm'])} \\\\"
        for k, c in res["contrasts"].items()
    ]
    return "\n".join(
        [
            "\\begin{tabular}{lrrr}",
            "\\hline",
            "Arm & Done rate (\\%) & Hours before deadline & Conflict free (\\%) \\\\",
            "\\hline",
            *rows,
            "\\hline",
            "\\end{tabular}",
            "",
            "\\begin{tabular}{lrrr}",
            "\\hline",
            "Contrast & Points & 95\\% CI & $p$ (Holm) \\\\",
            "\\hline",
            *crows,
            "\\hline",
            "\\end{tabular}",
            "",
        ]
    )
