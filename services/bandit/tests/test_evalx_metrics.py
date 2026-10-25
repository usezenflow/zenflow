"""The eval statistics are right before any result is read."""

from __future__ import annotations

import numpy as np

from evalx import metrics as m


def test_done_rate_edges() -> None:
    assert m.done_rate(np.zeros(5)) == 0.0
    assert m.done_rate(np.ones(5)) == 1.0
    assert np.isnan(m.done_rate(np.array([])))


def test_margin_and_last_day_share() -> None:
    deadlines = np.array([10 * m.HOUR_MS, 48 * m.HOUR_MS])
    margin = m.deadline_margin_h(np.array([0, 0]), deadlines)
    assert margin.tolist() == [10.0, 48.0]
    assert m.last_day_share(margin) == 0.5


def test_conflict_free_rate() -> None:
    s = np.array([0, 50, 200])
    e = np.array([60, 100, 260])
    assert m.conflict_free_rate(s, e, []) == 1 / 3
    assert m.conflict_free_rate(s, e, [(210, 220)]) == 0.0
    assert m.conflict_free_rate(s[2:], e[2:], []) == 1.0
    assert np.isnan(m.conflict_free_rate(s[:0], e[:0], []))


def test_burden_counts_every_event() -> None:
    assert m.burden(np.array([1, 0, 1]), np.array([1, 1, 0]), np.zeros(3)) == 4.0


def test_regret_is_zero_against_itself_and_grows_with_gap() -> None:
    oracle = np.ones((4, 6))
    assert m.cumulative_regret(oracle, oracle).tolist() == [0.0] * 6
    arm = np.zeros((4, 6))
    assert m.cumulative_regret(oracle, arm).tolist() == [1, 2, 3, 4, 5, 6]


def test_learning_curve_windows_first_tasks() -> None:
    started = np.tile(np.array([0.0, 1.0, 1.0]), (3, 1))
    assert m.learning_curve(started, 2).tolist() == [0.0, 1.0]


def test_bootstrap_on_constant_data_collapses() -> None:
    lo, hi = m.bootstrap_ci(np.full(40, 0.7))
    assert lo == hi == 0.7


def test_bootstrap_is_seeded_and_brackets_the_mean() -> None:
    x = np.random.default_rng(1).normal(2.0, 1.0, 200)
    assert m.bootstrap_ci(x, 3) == m.bootstrap_ci(x, 3)
    lo, hi = m.bootstrap_ci(x, 3)
    assert lo < x.mean() < hi


def test_cluster_rate_edges() -> None:
    none = m.cluster_rate(np.zeros(5), np.zeros(5))
    assert np.isnan(none["rate"]) and np.isnan(none["ci_lo"])
    full = m.cluster_rate(np.full(5, 2.0), np.full(5, 2.0))
    assert full["rate"] == full["ci_lo"] == full["ci_hi"] == 1.0


def test_sign_flip_separates_a_real_effect_from_noise() -> None:
    rng = np.random.default_rng(0)
    assert m.sign_flip_p(rng.normal(1.0, 1.0, 100)) < 0.01
    assert m.sign_flip_p(rng.normal(0.0, 1.0, 100)) > 0.05
    assert m.sign_flip_p(np.zeros(10)) == 1.0


def test_holm_known_case() -> None:
    assert m.holm([0.01, 0.04, 0.03]) == [0.03, 0.06, 0.06]
    assert m.holm([0.5]) == [0.5]
    assert m.holm([0.4, 0.9]) == [0.8, 0.9]


def test_contrast_reports_the_paired_mean() -> None:
    diff = np.tile(np.array([1.0, 0.0, -1.0, 1.0]), 3)
    c = m.contrast(diff, seeds=3)
    assert c["mean"] == 0.25
    assert c["ci_lo"] <= 0.25 <= c["ci_hi"]
    assert 0.0 < c["p"] <= 1.0
    assert c["share_better"] == 0.5 and c["share_worse"] == 0.25
