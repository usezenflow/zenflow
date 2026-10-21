# Offline eval protocol: heuristic vs matrix seeded LinUCB

Harness: `services/bandit/evalx/`. Simulated students only. Traits are assumptions, so results show behaviour under stated assumptions, not real lift. Every rule and statistic is in [the report](./offline-eval-report.md).

## Run

```bash
uv run python -m evalx run --seeds 100 --students 100               # 10,000 students per world
uv run python -m evalx sensitivity --seeds 10 --students 100        # seeds 100 to 109
uv run python -m evalx deadline --seeds 20 --students 100           # deadline weight and reach
uv run python -m evalx.bench                                        # ms per placement and update
uv run python -m evalx.diagnose                                     # where each policy places blocks
```

Outputs go to `evalx/out/` (ignored): `results.json`, `sensitivity.json`, `deadline.json`, `bench.json`, `placement-diagnostic.json`.

## Design

- Policies: H0 (default table), H0-broad (heuristic on the broad matrix), L0 (LinUCB seeded from the broad matrix), L0-cold, L0-old (seeded from the default table), L0-deadline and H0-deadline (deadline term off). Bounds: Oracle, Rand. AB is the live protocol with L0.
- Heuristic settings swept in `sensitivity`: table learning rate, kept-slot weight. Also prior weight and alpha.
- Rewards follow ADR-0035 and `backend/src/scheduler/constants.ts`; a test pins them.
- Worlds: six true bands, a weekend world, an attention sweep, an absent student, a routine change. Lecture timetable, no exams or assignments, no reschedules.
- Reaction mix (drag, tap, ignore): 10%, 60%, 30%; the others are in the sensitivity run.
- Common random numbers across policies. Seeds 100 and up for tuning, 0 to 99 for the main run.

## Statistics

- Effect: starts per student, paired across policies. Two 95% intervals: percentile bootstrap over students and over seeds, 2,000 resamples.
- Rates (pick, offered, tapped): ratio of sums, bootstrap by student.
- Verdict: margin 0.5 starts, read from the wider of the two intervals. No p-values and no multiplicity correction.

## Gates (`tests/test_evalx.py`)

Placer parity with `/v1/place`, reward parity with the backend, seed determinism, A/A identity, Oracle at least every policy, Rand below the learning policy, label neutral pick, weekend traits, knob restore.

## Deadline distance

Every arm reports the mean hours from a block's end to its deadline and the share ending within 24 hours, over tasks with a window of 3 days or more.
