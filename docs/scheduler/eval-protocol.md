# Offline eval protocol: heuristic vs LinUCB

Harness: `services/bandit/evalx/`. Simulated students only. Traits are assumptions, so results show behaviour under stated assumptions, not real lift.

## Run

```bash
uv run python -m evalx run --seeds 30 --students 100 --seed-offset 0   # held-out, 3,000 students per world
uv run python -m evalx sensitivity --seeds 10 --students 100            # tuning seeds 100+
uv run python -m evalx.figures                                          # F1 to F3
uv run python -m evalx.diagnose                                         # where each policy places blocks
```

Outputs go to `evalx/out/` (ignored): `results.json`, `report.md`, `sensitivity.md`, figures.

## Design

- Arms: H0, H1 (heuristic seeded with the stated band, the fair control), H1-deadline, L0, S, S-gap, S-deadline, S-tiebreak, Oracle, Rand, and AB (live protocol: 50/50 primary, both slots, pairwise offer).
- Heuristic knobs swept in `sensitivity`: table learning rate, kept-slot weight, table value outside the stated band.
- Rewards follow ADR-0035 and `backend/src/scheduler/constants.ts`; a test pins them.
- Worlds: 5 true bands x correct or wrong stated band, an attention sweep, an absent student, a routine change. Lecture timetable, no exams or assignments.
- Reaction mix (drag, tap, ignore): `tap_heavy` is the headline; the others are in the sensitivity run.
- Common random numbers across arms. Seeds 100+ for tuning, 0 to 29 held out.

## Statistics

- Effect: starts per student, paired across arms. Two 95% intervals: bootstrap over students and bootstrap over seeds.
- Pick rate: ratio of sums, bootstrap by student.
- Non-inferiority: S - H1 lower bound above -0.5 starts (both intervals).

## Gates (`tests/test_evalx.py`)

Placer parity with `/v1/place`, reward parity with the backend, seed determinism, A/A identity, Oracle at least every arm, Rand below S, label-neutral pick.
