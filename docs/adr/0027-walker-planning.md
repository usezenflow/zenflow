# ADR-0027: Walker planning for the occurrence cache

**Status:** Accepted; refines the claim order of [ADR-0024](0024-split-ingestion-queues.md)
**Date:** 2026-10-19
**Issue:** none filed

## Context

- A timetable walk for one student writes the section meetings of every section they attend. Classmates in those sections are then served from the cache.
- Claim order was oldest-first by last success, blind to sections. A wide student could be walked late, and narrow students early, so the cache warmed by chance.
- The cache TTL was 7 days, which refetched whole sections often mid-term.

## Decision

- **Weighted greedy walker order.** `planWalkers` (`core/walker-planner.ts`) orders discovered students of the current term. A section's weight is the number of students enrolled in it. A student's score is the summed weight of the stale sections they still warm. The top scorer is taken, its sections counted warm, and the scores recomputed. Ties keep input order.
- **Input order is the rotation.** Candidates are read least recently claimed first, so a walker moves to the back after they are picked.
- **Per-term plan, 15 minutes.** `WalkerPlanService` computes the order over the term's discovered students and reuses it for 15 minutes. It is empty when the occurrence cache is off.
- **Failure falls through.** A student with `consecutiveFailures > 0` is left out, so their sections go to the next enrolled student.
- **Claim the plan first.** `IngestionScheduleService.claimDue` takes an optional preferred user list. It reads a window of `10 × batch` due rows, claims the preferred users in plan order, then the rest in the usual order.
- **Cache TTL is 30 days** (`INGESTION_CACHE_TTL_MS` default), down from 7 days of refetching.
- **Per-week jobs and fan-out are unchanged** (ADR-0024). Every section in a walker's week response is fanned out, not only the planned ones.

## Algorithm

```
planWalkers(candidates, stale):
  weight[s] = count of candidates holding s
  cold      = copy of stale
  order     = []
  loop:
    best = candidate maximising sum(weight[s] for s in its sections if s in cold)
           (ties: earliest in input order)
    if no candidate scores above 0: break
    order.append(best); remove best from pool
    cold -= best.sections
  return order + remaining pool in input order

preferred(now):                        # WalkerPlanService, cached 15 min per term
  if cache off: return []
  users      = discovered this term, consecutiveFailures = 0,
               least recently claimed first
  sections   = confirmed sections (droppedAt null) of those users
  stale      = timetableFreshness(sections, through term end)
  return planWalkers(users with their sections, stale)

claimDue(kind, batch, preferred):      # timetable only
  rows = due rows, take 10 * batch, usual order
  stable-sort rows by position in preferred (unplanned last)
  claim the first `batch` rows, compare-and-set on nextDueAt

week job(walker, week):                # unchanged, ADR-0024
  fetch week
  for each section in the response:
    cache.record(section, week)
    fan out to every student confirmed in section, via the materializer
```

Cost: one plan is O(picks × candidates × sections). It runs at most once per 15 minutes per term.

## Consequences

- Fewer upstream timetable walks for the same students. Not yet measured on the fake DLU server; the bench comparison is open.
- A plan can be up to 15 minutes old. A new registration is stale until the next plan, though its own walk still runs when its row is due.
- A walker with a failed week is skipped until their next success.
- Rotation is approximate: it follows claim order, not a per-section walker history.
