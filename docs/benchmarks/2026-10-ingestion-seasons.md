# Ingestion seasonal schedule simulation (2026-10-19)

Dev-facing. Checks the seasonal schedule rules in [ingestion.md](../backend/ingestion.md#rules) against the fake DLU server on the `loadtest/compose.ingestion.yml` stack.

## Method

- 40 students, API on the host, infra in containers. Time is compressed: 1 h is 5 s (the tick), 3 h is 15 s, the start-of-week timetable is 30 s.
- The calendar is set by overrides instead of the date: `INGESTION_EXAM_WINDOW`, `INGESTION_MARKS_AFTER_EXAMS_MS`, `INGESTION_TIMETABLE_WEEKLY_MS`.
- The fake server publishes half of each student's exams, then all of them (`POST /_/exams`), dated 3 days back.
- Counts are upstream requests per interval, plus scheduled runs from `SyncRun` (a cache-served timetable pass makes no request).

```bash
docker compose -f loadtest/compose.ingestion.yml up -d
cd backend && pnpm build
INFRA=loadtest SEASONS=1 OUT=/path/to/out bash scripts/fixtures/dlu/bench.sh 5 0
```

## Results

| Interval | Discovery | Timetable | Exam | Marks | Profile | LMS calendar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warm-up, exam window closed | 79 | 260 | 0 | 42 | 80 | 74 |
| Steady state, 35 s | 3 | 0 | 0 | 0 | 0 | 6 |
| Exams, half published, 8 s | 0 | 0 | 40 | 0 | 0 | 0 |
| Exams, all published, 12 s | 0 | 0 | 22 | 0 | 0 | 0 |
| Marks due, 15 s, exams still open | 0 | 0 | 0 | 43 | 0 | 0 |

Scheduled runs (total / served from cache):

| Interval | Timetable | LMS calendar |
| --- | ---: | ---: |
| Warm-up | 272 / 246 | 690 / 653 |
| Steady state, 35 s | 40 / 40 | 234 / 231 |
| Exams, half published | 0 | 40 / 40 |
| Exams, all published | 40 / 40 | 120 / 120 |
| Marks due | 14 / 14 | 80 / 80 |

## Reading

- **Timetable:** rolling while discovery covers under 95% of students (272 runs in the warm-up), then one run per student per weekly interval (40 per 30 s).
- **Exams:** none outside the window. At half publication every student is fetched once. After full publication 22 more fetch; the other 18 had one exam section, already covered. Every exam row ends parked at the term end, and the open window fetches nothing afterwards.
- **Marks:** none until the wait after the first exam has passed, then a refetch per student.
- **Discovery:** every portal row ends parked until the next term's lookahead (2026-12-13).

The warm-up reported 4 students still missing a step after its 180 s cap; the cause was not investigated.
