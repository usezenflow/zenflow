"""Marks profile: the ``weak`` score that shapes prep sizing and the cross features.

``weak`` runs from 0 (strong record) to 1 (failing record). Students with no marks
get ``COHORT_WEAK_DEFAULT``. Credits weight every letter; an unknown letter is
ignored.
"""

from __future__ import annotations

from collections.abc import Sequence

LETTER_POINTS: dict[str, float] = {"A": 4.0, "B": 3.0, "C": 2.0, "D": 1.0, "F": 0.0}
COHORT_WEAK_DEFAULT = 0.5


def _letter_key(letter: str | None) -> str | None:
    """First letter of a grade (``B+`` reads as ``B``), or ``None`` when unknown."""
    if not letter:
        return None
    key = letter.strip()[:1].upper()
    return key if key in LETTER_POINTS else None


def weak_score(
    marks: Sequence[tuple[str | None, int]],
    avg_gpa4: float | None,
) -> float:
    """``weak`` from ``(letter, credits)`` pairs and the student's GPA on 4.

    ``weak = 0.5 * (1 - gpa4 / 4) + 0.5 * (share of D and F credits)``, clamped
    to 0 to 1. Without a stored GPA the credit-weighted mean of the letters
    stands in for it.
    """
    graded: list[tuple[str, int]] = []
    for letter, credits in marks:
        key = _letter_key(letter)
        if key is not None and credits > 0:
            graded.append((key, credits))

    total_credits = sum(c for _, c in graded)
    if total_credits == 0:
        return COHORT_WEAK_DEFAULT

    gpa4 = avg_gpa4
    if gpa4 is None:
        gpa4 = sum(LETTER_POINTS[k] * c for k, c in graded) / total_credits
    failing = sum(c for k, c in graded if k in ("D", "F")) / total_credits

    weak = 0.5 * (1 - gpa4 / 4) + 0.5 * failing
    return min(1.0, max(0.0, weak))
