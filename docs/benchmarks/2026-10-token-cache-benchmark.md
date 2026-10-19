# Upstream session cache benchmark (2026-10-19)

Dev-facing. Upstream request counts for the DLU ingestion pipeline with no cache, with the occurrence cache only, and with the occurrence cache plus the upstream session cache (portal token, DKHP token, LMS cookie and sesskey).
Method and earlier results: [ingestion-cache-benchmark.md](ingestion-cache-benchmark.md).

## Status

Run complete: 1 repeat per case, 5-minute window. All checks pass. The three modes end with identical calendars (3,249 rows each). One repeat gives no variance estimate; treat the numbers as indicative until a second repeat is run.

## Cases

| Case | Mode | Occurrence cache | Session cache |
| ---- | ---- | ---------------- | ------------- |
| A | No cache | off | off |
| B | Occurrence cache only | on | off (token TTLs 0) |
| C | Occurrence and session cache | on | on, TTLs scaled to the run |

Time is scaled so that the portal sync period is 5 minutes (production: 3 hours), and the LMS calendar period is 15 seconds. Session TTLs are 200 seconds for portal and DKHP and 100 seconds for LMS (production: 100 and 50 minutes), so tokens expire inside the window and the runs exercise re-login. The occurrence cache TTL is 90 seconds.

## Workload

- Five 60-second ticks, 150 students, 1 repeat. Totals are upstream requests to the fake DLU server over the measured window.
- Each run deletes the `StudentProfile` rows, so students fetch profile, study programs and marks inside the window. These are not cacheable. 110 students per run complete them inside the window in B and C, and 140 in A.
- Mid-run, the first enrolled student (by email) of each of 8 changed sections moves their lectures an hour later and the second deletes theirs: 80 moved, 50 deleted. The step waits until those students' lectures are written, so every mode mutates the same rows.
- Each run starts with every student due: the first walk happens at the start of the run, and the next walk is due one portal period later. The bench sets the timetable's weekly cadence to the portal period, so rows re-walk within the window.

## Results

| Mode | Total | Auth | Data | Login | Sesskey | Authenticate |
| ---- | ----: | ---: | ---: | ----: | ------: | -----------: |
| A. No cache | 26,243 | 17,436 | 8,807 | 8,768 | 4,384 | 4,284 |
| B. Occurrence cache only | 3,491 | 1,910 | 1,581 | 440 | 220 | 1,250 |
| C. Occurrence and session cache | 2,032 | 460 | 1,572 | 216 | 108 | 136 |

Change against A:

| Mode | Total | Auth | Data |
| ---- | ----: | ---: | ---: |
| B. Occurrence cache only | -87% | -89% | -82% |
| C. Occurrence and session cache | -92% | -97% | -82% |

Session cache against occurrence cache only (C vs B): total -42%, auth -76%, data -1%.

Requests per tick:

| Tick | A. No cache | B. Occurrence only | C. Occurrence and session |
| ---: | ----------: | -----------------: | ------------------------: |
| 1 | 5,326 | 930 | 609 |
| 2 | 5,402 | 841 | 445 |
| 3 | 5,368 | 598 | 348 |
| 4 | 4,900 | 436 | 240 |
| 5 | 5,247 | 686 | 390 |

Data requests per tick:

| Tick | A. No cache | B. Occurrence only | C. Occurrence and session |
| ---: | ----------: | -----------------: | ------------------------: |
| 1 | 1,889 | 491 | 546 |
| 2 | 1,835 | 384 | 325 |
| 3 | 1,797 | 241 | 247 |
| 4 | 1,555 | 199 | 197 |
| 5 | 1,731 | 266 | 257 |

Discovery requests in measured ticks: 0 in every case.

## Checks

| Check | A. No cache | B. Occurrence only | C. Occurrence and session |
| ----- | ----------- | ------------------ | ------------------------- |
| Calendars match A | reference | pass | pass |
| Calendar rows | 3,249 | 3,249 | 3,249 |
| Moved lectures kept (of 80) | 80 | 80 | 80 |
| Moved lectures overwritten | 0 | 0 | 0 |
| Deleted lectures kept (of 50) | 50 | 50 | 50 |
| Other students' changed rooms applied (of 160) | 160 | 160 | 160 |
| Other students' sessions stale | 0 | 0 | 0 |
| Removed sections still live | 0 | 0 | 0 |
| Exam cache rows | 0 | 0 | 0 |

## Reproduce

```bash
docker compose -f loadtest/compose.ingestion.yml up -d
cd backend && npm run build
INFRA=loadtest PERIODS=scaled PORTAL_PERIOD_MS=300000 CASES=A,B,C REPEATS=1 \
  OUT=/path/to/out bash scripts/fixtures/dlu/bench.sh 5 4
node scripts/fixtures/dlu/token-cache-report.js /path/to/out
```

The first positional argument is the number of 60-second ticks in the window. The loadtest stack uses its own database and Redis, and the benchmark drops and recreates its `zenflow` database on that stack.
