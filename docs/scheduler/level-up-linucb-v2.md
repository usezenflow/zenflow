# Report: heuristic vs LinUCB v2, by start rate and regret

**Context.** Zenflow is a study planner. Students add exams and assignments and rarely move the plan they are
given. When a new exam or assignment arrives, the app places a prep plan for it. The student can start the
plan, ignore it, or pick the alternative time the app offers.

We compared two ways of choosing the slot, using simulated students who mostly tap or ignore proposals:

1. **Heuristic:** a rule-based method with a table of favourite hours. It now learns from what the student does
   in a slot (started, done, lapsed), not only from drags.
2. **LinUCB v2:** a learning method that uses the student's stated focus band as its starting point, and chooses
   the hour inside a band by how much free time surrounds the slot.

**Terms used below.**

- *Proposal:* one slot the app places for one task (or one sitting of a multi-sitting task).
- *Start:* the student starts the session in its slot.
- *Start rate:* the share of proposals the student starts.
- *Regret:* how much worse the proposed slot is than the best free slot, in the student's own taste.
- *Lazy profile:* the mix of students used throughout: 10% drag proposals, 60% tap the alternative or keep, 30% ignore.

## 1. The answer in short

| | Heuristic | LinUCB v2 |
| --- | --- | --- |
| Start rate (higher is better) | 39.3% | ***45.2%*** |
| Average regret (lower is better) | 0.498 | ***0.306*** |
| Start rate, first 5 proposals (higher is better) | 34.8% | ***38.4%*** |
| Start rate, after 40 proposals (higher is better) | 39.8% | ***45.2%*** |
| Regret, first 5 proposals (lower is better) | 0.664 | ***0.595*** |
| Regret, after 40 proposals (lower is better) | 0.467 | ***0.278*** |

(Exact definitions are in section 3.)

- **LinUCB v2 starts more proposals.** The start rate is 5.9 points higher overall, and it is higher for every
  student type.
- **LinUCB v2 has lower regret everywhere.** It is 0.19 lower overall, and lower for all 15 types.
- **The gap is largest after the first few proposals.** In the first 5 it is 3.6 points; from proposal 6 to 40 it
  is 7.9 to 9.4 points.
- **Confidence:** this is 14,000 students, one seed. The intervals on the differences are narrow (section 5.1), so
  the ordering is clear at this size. Judge a difference by its size.
- **Limit:** the students are simulated, and the start label is binary. The results show how the systems behave,
  not how real people will respond. Section 7 lists the limits in full.

## 2. The two systems

**Heuristic.**

- Keeps a table with one liking score for each hour of each weekday (7 × 24 cells).
- The table starts from defaults:
  - 09:00-12:00 scores 1.0, 14:00-17:00 scores 0.5, 19:00-22:00 scores 0.2, and every other hour 0.
  - Saturday and Sunday use the same hour scores as weekdays.
- It proposes the free slot with the best score.
- Learning from the student's behaviour (changed in this step):
  - when the student drags a proposal, the table shifts toward the new hour, as before;
  - when the student starts or finishes a kept proposal, its hour rises by 0.25 × the completion reward (+1);
  - when the student lapses it, its hour falls by 0.25 × 0.25;
  - a skip or a wrong-time check-off leaves the hour unchanged.

**LinUCB v2.**

- Splits the day into 6 time bands: 00-08, 08-12, 12-14, 14-18, 18-22 and 22-24.
- Keeps one small model per band that predicts how much the student will start a task placed in that band. The
  prediction uses days until the deadline, the task's length, how busy the day is, and whether it is a weekend.
- **Starting point.** The student's stated focus band (morning, afternoon, evening or late night) gives each band a
  prior before any data arrives. Bands that match the student's focus start ahead of the others, so the first
  proposals land in the right part of the day instead of breaking a tie.
- **Choosing the hour.** The favourite-hours table no longer picks the hour. Each free slot is scored by how much
  free time it has on each side (up to an hour each side, so a slot with an hour free on both sides scores best),
  and the band prediction still picks the band.
- **Learning.** After each proposal it updates the band's model from the outcome: +1 when the student starts or
  finishes the slot, -0.25 when the placement lapses, and 0 when it is skipped or checked off at the wrong time.
- Quiet hours (23:00 to 06:00) are a hard limit for both systems.

## 3. How to read the numbers

- All numbers are per proposal, averaged over students.
- In every table, ***bold italic*** marks the best value in its row. Ties are both marked.
- Absolute values in the tables have no interval. Differences between the two systems do, and they are the figures
  to read.

A **proposal** is one slot the system places for one task. The formulas below use these symbols for proposal *i*:

- *U(slot)* is the student's hidden utility of a slot: a unitless "how much would this student like to study
  then" score. A student's ideal hour scores about 1, ordinary hours less, and sleeping hours below 0.
- *best* is the free slot with the highest *U* inside the task's allowed window (the "oracle", which only the
  simulator can see).
- *proposed* is the slot the system placed.
- *started(i)* is 1 when the student starts the session in its slot, and 0 otherwise.

| Metric | Formula | In plain words | Better is |
| --- | --- | --- | --- |
| **Start rate** | `(number of proposals with started = 1) / (number of proposals)` | The share of placed sessions the student starts. The label is binary: the simulator does not model how late the start is. | higher |
| **Regret** | mean over proposals of `U(best) - U(proposed)` | How much worse the placed slot is than the best free slot, in the student's own taste. 0 means the placement was the best slot. | lower |
| **Cold-start bucket** | proposals grouped by how many earlier reactions the student had given: 0-5, 6-10, 11-20, 21-40, 41 or more | How each system does while it knows little about the student, and after it has learned. | per row |

Notes on these definitions:

- Every figure is an average over all proposals of all students, except the cold-start buckets, which are averages
  over the proposals in each bucket.
- Drag and kept are not reported. Under the lazy profile 90% of students do not drag, so those figures mostly
  measure the 10% who drag. Time to first start is not reported either: its median is 2 placements for both systems,
  so it does not separate them.

**Confidence intervals.**

- Each interval is a 95% bootstrap over students: resample the students with replacement 2,000 times, recompute the
  metric each time, and report the 2.5th and 97.5th percentiles.
- The two systems run on the same students, so each difference is resampled with the same students for both.
- At 14,000 students the intervals are narrow, so nearly every difference is clear. Judge by the size of a difference.
- The intervals only reflect which simulated students were drawn, from one seed. They do not show run-to-run spread.

**Known limitation: infeasible placements.** When no free slot exists inside a task's window the simulator records no
proposal for that member, whereas production still assigns a start through displacement or the last resort. Crowded
cases are therefore under-represented. Every difference is taken over the placements both systems produced (same task
and member), so the comparison stays paired.

## 4. How we tested

**Simulated students.** The same 15 types as the drag report: three when-they-work-best labels crossed with five
behaviour labels. The simulator and student generator are unchanged from that report.

- *When they work best:* early bird, midday or night owl.
- *How they behave:* stable, erratic, crammer, planner or weekender.

**Run.** 14,000 students (about 930 per type), 60 task arrivals per student per scenario, seed 1.

**Scenarios.** Five scenarios: a single task, and 3- or 6-sitting series in loose or tight deadline windows. A
tight series squeezes its sittings into a few days, so there is little choice of slot; a loose series spreads them
out, so there is room to pick good hours and to pick badly.

**Lazy profile.** 10% of students drag a proposal to a better slot when the gain is large enough. 60% tap: they
choose between the proposed slot and the alternative offered, by utility. 30% ignore the proposal. The shares are an
assumption, taken from the plan's target of students who rarely move the plan.

**Reaction.** A student starts a proposal with a probability that rises with the slot's utility. Both systems face
the same student, calendar, tasks and random draws, and each system runs in its own copy of the calendar.

**Starting point.** Both systems begin with no learning. The heuristic table starts from its defaults. LinUCB v2
starts from the band prior (section 2).

## 5. Results

### 5.1 Overall

| Metric | Heuristic | LinUCB v2 | LinUCB v2 - heuristic |
| --- | --- | --- | --- |
| Start rate | 39.3% | ***45.2%*** | +5.9 pts [+5.8, +6.0] |
| Regret | 0.498 | ***0.306*** | -0.192 [-0.195, -0.190] |

Intervals are on the difference. For regret a negative value favours LinUCB v2; for start rate a positive value does.
All differences have intervals that exclude 0.

Total: 15.8 million proposals.

### 5.2 By student type

Start rate and regret, by when the student works best and how they behave:

| Type | Start: Heur. | LinUCB v2 | Regret: Heur. | LinUCB v2 |
| --- | --- | --- | --- | --- |
| night owl, crammer | 42.5% | ***55.5%*** | 0.778 | ***0.360*** |
| night owl, planner | 44.8% | ***54.3%*** | 0.659 | ***0.354*** |
| night owl, stable | 35.2% | ***43.7%*** | 0.641 | ***0.363*** |
| night owl, weekender | 37.0% | ***45.1%*** | 0.539 | ***0.271*** |
| night owl, erratic | 32.7% | ***40.5%*** | 0.630 | ***0.389*** |
| midday, crammer | 44.9% | ***48.6%*** | 0.402 | ***0.283*** |
| midday, planner | 50.0% | ***53.7%*** | 0.400 | ***0.281*** |
| midday, stable | 39.6% | ***42.9%*** | 0.382 | ***0.279*** |
| midday, weekender | 41.3% | ***45.5%*** | 0.384 | ***0.230*** |
| midday, erratic | 37.6% | ***40.6%*** | 0.436 | ***0.343*** |
| early bird, planner | 43.8% | ***49.3%*** | 0.461 | ***0.281*** |
| early bird, crammer | 38.6% | ***43.3%*** | 0.442 | ***0.291*** |
| early bird, stable | 33.8% | ***38.6%*** | 0.438 | ***0.284*** |
| early bird, weekender | 37.4% | ***42.2%*** | 0.411 | ***0.233*** |
| early bird, erratic | 30.7% | ***34.7%*** | 0.478 | ***0.347*** |

Differences in start rate (LinUCB v2 - heuristic, points):

| Type | Night owl | Midday | Early bird |
| --- | ---: | ---: | ---: |
| crammer | +13.0 | +3.8 | +4.7 |
| planner | +9.4 | +3.6 | +5.5 |
| stable | +8.5 | +3.3 | +4.8 |
| weekender | +8.1 | +4.2 | +4.8 |
| erratic | +7.7 | +3.0 | +3.9 |

Every per-type difference in start rate and regret has an interval that excludes 0.

### 5.3 Cold start and after learning

| Prior reactions | Start: Heur. | LinUCB v2 | Start diff | Regret: Heur. | LinUCB v2 | Regret diff |
| --- | --- | --- | --- | --- | --- | --- |
| 0 to 5 | 34.8% | ***38.4%*** | +3.6 pts | 0.664 | ***0.595*** | -0.070 |
| 6 to 10 | 36.5% | ***44.4%*** | +7.9 pts | 0.640 | ***0.453*** | -0.187 |
| 11 to 20 | 37.7% | ***46.4%*** | +8.7 pts | 0.639 | ***0.421*** | -0.218 |
| 21 to 40 | 38.0% | ***47.4%*** | +9.4 pts | 0.630 | ***0.381*** | -0.249 |
| 41 or more | 39.8% | ***45.2%*** | +5.4 pts | 0.467 | ***0.278*** | -0.189 |

Share of proposals in each bucket: 2.7% (0 to 5), 2.2% (6 to 10), 4.4% (11 to 20), 8.9% (21 to 40) and 81.9% (41 or more).

The 41-or-more bucket is the most stable reading of the late stage: it holds most of the proposals. The heuristic
starts higher late in a student's run than early, so its 41-or-more row is above its 0-to-5 row.

### 5.4 By scenario

| Scenario | Start: Heur. | LinUCB v2 | Start diff | Regret: Heur. | LinUCB v2 | Regret diff |
| --- | --- | --- | --- | --- | --- | --- |
| Single task | 40.8% | ***52.7%*** | +11.9 pts | 0.720 | ***0.449*** | -0.271 |
| 3 sittings, loose | 40.1% | ***48.8%*** | +8.7 pts | 0.597 | ***0.360*** | -0.237 |
| 3 sittings, tight | 38.8% | ***45.0%*** | +6.2 pts | 0.420 | ***0.257*** | -0.163 |
| 6 sittings, loose | 40.1% | ***45.2%*** | +5.1 pts | 0.534 | ***0.329*** | -0.205 |
| 6 sittings, tight | 38.2% | ***42.2%*** | +4.0 pts | 0.413 | ***0.254*** | -0.159 |

Every scenario difference has an interval that excludes 0.

## 6. What the results mean

**Why LinUCB v2 starts more proposals.**

- Its hour rule and band prior put each placement in a band the student is likely to start, and the free-time rule
  moves the start inside that band away from back-to-back events.
- The gain is smallest for the first 5 proposals (3.6 points), because the band prior is only a starting point. It
  grows as the band models learn, to 9.4 points by 21 to 40 proposals.

**Night owls gain the most.**

- The default favourite-hours table points at the morning, so the heuristic places night owls at the wrong hours and
  unlearns slowly. Night owl crammers gain 13 points.
- Night owls are also where the regret gap is widest (0.24 to 0.42 lower for LinUCB v2).

**Early birds and midday students gain too.**

- Gains are 3 to 5.5 points for both. These are the two groups the drag-only report found the heuristic better for,
  so the previous ordering does not carry over under the lazy profile.
- That report used a drag-only profile and an earlier simulator. Its numbers are not comparable to this report.

**Students who drag are the exception.**

- In a 75-student, 3-seed run with drag-only students, the start rates were 47.7% for LinUCB v2 and 47.6% for the
  heuristic. The gain in this report depends on students who do not drag. Drag-heavy students need a separate check
  at scale.

## 7. Verdict

**Use LinUCB v2 as the placement policy; keep the heuristic as the control.** Compared with the heuristic it gives:

- 45.2% of proposals started, against 39.3%,
- 0.19 lower regret (0.31 against 0.50),
- a 3.6-point start-rate gain from the first placements, and up to 9.4 points once it has learned.

**Limits.**

- The students are simulated. The lazy profile (10% drag, 60% tap, 30% ignore) is an assumption, and the start rule
  is a model of the student.
- The start label is binary. It does not model how late a student starts a session.
- One seed. The intervals reflect which students were drawn, not run-to-run spread.
- The gain disappears for drag-only students in the small run (section 6). It has not been checked at scale.
- Results for the hybrid model (shared cross features and cohort warm start) are not in this report. They are in the
  three-model report.
