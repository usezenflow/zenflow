# Offline eval protocol: heuristic vs LinUCB (S-band)

Harness: `services/bandit/evalx/`. Simulated students only. Traits are assumptions, so results show behaviour under stated assumptions, not real lift. Every rule and statistic is in [the report](./offline-eval-report.md).

## Run

```bash
uv run python -m evalx run --seeds 50 --students 100 --arms H0,H1,L0,S-band,Oracle,Rand,AB-band --out evalx/out/main   # 5,000 students per world
uv run python -m evalx sensitivity --seeds 10 --students 100        # seeds 100 to 109
uv run python -m evalx.diagnose                                     # where each policy places blocks
uv run python -m evalx.figures --out evalx/out/main                 # F1 to F3
```

Outputs go to `evalx/out/` (ignored): `results.json`, `sensitivity.json`, `placement-diagnostic.json`, figures.

## Design

- Policies: H0 (default table), H1 (table seeded from the stated band, the production baseline), L0 (LinUCB, no band), S-band (LinUCB with the band prior, no gap or deadline term, ties broken by stated-band hours then the earlier start). Bounds: Oracle, Rand. AB-band is the live protocol with S-band.
- Heuristic settings swept in `sensitivity`: table learning rate, kept-slot weight, table value outside the stated band.
- Rewards follow ADR-0035 and `backend/src/scheduler/constants.ts`; a test pins them.
- Worlds: 5 true bands x correct or wrong stated band, an attention sweep, an absent student, a routine change. Lecture timetable, no exams or assignments, no reschedules.
- Reaction mix (drag, tap, ignore): 10%, 60%, 30%; the others are in the sensitivity run.
- Common random numbers across policies. Seeds 100 and up for tuning, 0 to 49 for the main run.

## Statistics

- Effect: starts per student, paired across policies. Two 95% intervals: percentile bootstrap over students and over seeds, 2,000 resamples.
- Rates (pick, offered, tapped): ratio of sums, bootstrap by student.
- Verdict: margin 0.5 starts, read from the wider of the two intervals. No p-values and no multiplicity correction.

## Gates (`tests/test_evalx.py`)

Placer parity with `/v1/place`, reward parity with the backend, seed determinism, A/A identity, Oracle at least every policy, Rand below the learning policy, label-neutral pick, the tie rule.
