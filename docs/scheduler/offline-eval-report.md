# Report: heuristic vs LinUCB, offline eval with a same-band control

**Context.** Zenflow is a study planner. When a student adds a task, or a new exam or assignment arrives, the app places a study block for it
and may offer one alternative time. Before release we want to know whether the learning policy (LinUCB) places blocks better than the rule-based
policy (the heuristic).

We answer this with simulated students, because the live test will have too few users to decide it early ([A/B plan](./ab-testing.md)). The comparison
is made fair on purpose: LinUCB uses the focus band the student states at onboarding, so the heuristic is started from the same band.

This report states every rule of the simulated student, every formula for the two policies, and every statistic. Nothing is a black box. The
simulated students are our assumptions, and the report says so wherever it matters.

## Glossary

Read this first. Every table in the report uses these terms.

**The students**

- **Simulated student:** a program that reacts to placements by fixed rules (section 3). There are no real people in this report.
- **True band:** the clock hours in which the student really starts studying, for example 17:00 to 21:00.
- **Stated band:** the answer given at onboarding to "when do you focus best?": morning (08 to 12), afternoon (12 to 17), evening (17 to 21) or late night (21 to 02). Both policies use it.
- **Correct** means the stated band is the one whose centre is nearest the true band's centre (a 17 to 21 student says "evening"). **Wrong** means the one whose
  centre is farthest (the same student says "morning"). Both are tested, because real students may misreport.
- **Attention** is the chance that the student opens the Zenflow app during a block's time slot. It is not focus. A start is counted only when the app is opened in the block.
- **Drag, tap, ignore** are three ways a student treats a placement: move a block that is in the wrong place, answer the "keep or prefer this time?" offer, or do nothing.
- **World:** one kind of simulated student: a true band, a stated band and an attention level.

**The policies and bounds**

- **H0:** the rule-based policy (the heuristic) with the default favourite-hours table. It stands for a student who skipped onboarding.
- **H1:** the heuristic started from the stated band. It is the fair rival, because it gets the same information as LinUCB.
- **L0:** LinUCB with no stated band. **S:** LinUCB with the stated band, as shipped. **S-gap**, **S-deadline** and **S-tiebreak** are S with one part switched off.
- **Oracle:** the placement with the highest chance of a start (the ceiling). **Rand:** a random placement (the floor).

**The outcomes**

- **Start:** a task counts as started when its block begins inside the student's true band and the student opens the app in it (section 3.3). It is the only outcome this eval counts.
- **Starts per student:** the number of a student's 12 tasks that are started (section 4.1).
- **Pick rate:** among offers the student answered, the share where they chose LinUCB's time rather than the heuristic's (section 4.4).

## 1. The answer in short

The table counts the 17 worlds by what the main run (30 seeds, 3,000 students per world) shows for S minus H1, in starts per student.

| | Worlds | Which |
| --- | --- | --- |
| LinUCB clearly better than H1 | 8 of 17 | three correct-band worlds (09 to 17, 06 to 10, 13 to 17) and all five wrong-band worlds (13 to 17 by only 0.03) |
| LinUCB slightly worse (under 0.5 starts) | 4 of 17 | very low attention, absent, routine change |
| LinUCB worse (past the margin) | 5 of 17 | evening and night students with a correct band, attention 0.3 and above |

The main findings, each explained in the section named:

- LinUCB does not beat the fair control overall. It gains up to 6.05 starts in one world and loses up to 1.79 in another, so the worlds are not averaged (sections 3.2 and 5.1).
- The gain in the afternoon world exists because H1 places every block at 12:00, outside the student's 13:00 to 17:00 band. LinUCB places 83% of its blocks in band (section 5.2).
- Where LinUCB loses, H1 places all blocks in the student's band and LinUCB places 83% to 87%. LinUCB also places blocks closer to the deadline, which the student model rewards (section 5.2).
- The stated-band prior is what LinUCB adds. It is worth +1.7 to +4.8 starts when the band is right and costs 1.3 to 4.4 when it is wrong (section 5.5).
- The deadline term costs starts. Removing it helps in 13 of 17 worlds and never hurts by more than 0.01 (section 5.5).
- The heuristic's learning rate, kept-slot weight and band trust (0 to 0.8) change nothing at this horizon. Ignoring the band altogether does (section 5.7).
- More students do not change the picture. The 600-student run gives the same verdict in 15 of 17 worlds (section 5.8).
- The students are invented. The results show how the policies behave under the stated assumptions, not that real students will start more (section 7).

![S minus H1 by world](./figures/eval-f1-by-world.png)

## 2. The two policies

Both policies are the production code, called in process (`tests/test_evalx.py` checks the harness returns exactly what `/v1/place` returns). For each task they
scan every 15-minute start from the arrival day to the deadline that avoids busy time and quiet hours, score each start, and place the block at the highest score.

### 2.1 The heuristic (H0 and H1)

The heuristic keeps a table `m[w, h]` of liking scores, one per weekday `w` (7) and hour `h` (24). The score of a 60-minute block is the mean of the four
15-minute cell values it covers, plus a deadline penalty:

```text
score(block) = mean of m over the block's cells  -  0.2 * max(0, 1 - hours_left / 24)
```

where `hours_left` is the time between the block's end and the deadline. The highest score wins, and **the earliest block wins a tie**.

- **H0** starts from the default table, the same on every weekday: 1.0 for 09:00 to 11:00, 0.5 for 14:00 to 16:00, 0.2 for 19:00 to 21:00, and 0 for every other hour.
- **H1** starts from the stated band: `m = 1.0` for hours inside it on every weekday, `m = 0.2` outside.
- **Learning.** A cell moves by `cell <- clip(cell + 0.2 * delta, -1, 1)`. When a student starts a block, `delta = +0.25` for the block's start cell. When a student moves a
  block, the old cell gets `-g` and the new cell `+g`, where `g = min(1, drag_minutes / 240)`.

### 2.2 LinUCB (L0 and S)

LinUCB keeps one linear model per time band ("arm"), six in all: 00 to 08, 08 to 11, 11 to 14, 14 to 17, 17 to 20, 20 to 24. Each arm holds a matrix `A` (7 x 7) and a vector `b` (7).
For a candidate day the context `x` has 7 numbers: days to the deadline, task length, days from now, weekend sign, fixed load (lectures) hours, flexible load hours, and a constant 1.

```text
theta   = A^-1 b
UCB     = theta . x  +  alpha * sqrt(x^T A^-1 x)               alpha = 0.15
score(block) = sum over arms of  overlap(block, arm) * UCB_arm(day)
               + 0.2 * gap_quality(block)
               - 0.2 * max(0, 1 - hours_left / 24)
```

- `overlap(block, arm)` is the fraction of the block inside the arm's hours. The first term picks the band, because it is flat inside one.
- `gap_quality = 0.5 * min(free_before, 60) / 60 + 0.5 * min(free_after, 60) / 60`, where `free_before` and `free_after` are the free minutes between the block and the nearest
  lecture or quiet-hours edge. A block with an hour free on both sides scores 1; one squeezed between lectures scores 0.
- Exact ties break in three steps: the band that hosts the start, in a seeded random order; then the block's distance from that band's centre; then the earlier start. S-tiebreak replaces the seeded order with a fixed one.
- The shipped LinUCB has no preference-table term. The heuristic's table is used only by the heuristic.
- **Learning.** After a reward `r` on the arm that placed the block: `A <- A + x x^T` and `b <- b + r x`. Rewards (ADR-0035): a start gives +1; a move gives `-min(1, drag_minutes / 240)`;
  taking or keeping LinUCB's option in the pairwise offer gives +0.5; keeping the heuristic's option over it gives -0.2; ignoring gives nothing.
- **L0** starts each arm at `A = I`, `b = 0` (ridge 1). **S** starts each arm from the stated band: `A = I + 3 x_ref x_ref^T`, `b = 3 r_arm x_ref`, where `x_ref` is a fixed
  mid-horizon context and `r_arm = -0.2 + 0.7 * share`, with `share` the fraction of the arm's hours inside the stated band. An arm inside the band starts at +0.5, an arm outside at -0.2,
  each worth 3 pseudo-observations.
- Quiet hours are a hard limit: no block starts or runs between 23:00 and 06:00 (02:00 to 09:00 for a late-night stated band).

### 2.3 The switched-off variants and the bounds

- **S-gap:** S with the gap weight 0.2 set to 0. **S-deadline:** S with the deadline weight 0.2 set to 0. **S-tiebreak:** S with a fixed tie order instead of the seeded one.
- **H1-deadline:** H1 with its deadline weight set to 0. It scores the same as H1 in every world: the heuristic already picks the earliest in-band block, and the penalty only lowers the score of blocks near the deadline.
- **Oracle:** for each task, among all 15-minute starts inside the student's true band that fit between arrival and deadline, avoid lectures and avoid 02:00 to 06:00, the start with the highest
  start probability `p` (section 3.3), earliest on ties. In expectation no policy can start more tasks than this, so it is the ceiling.
- **Rand:** a random day in the task's window and a random whole hour from 08:00 to 21:00. It ignores lectures, the band and the deadline, so it is the floor.

## 3. The simulated student

### 3.1 Tasks and calendar

Each student gets `N = 12` tasks (3 a week for 4 weeks). Task `t` has these properties:

- It arrives at 08:00 on a day drawn uniformly from the 28 days, and lasts 60 minutes.
- Its deadline is `K` days after arrival, with `K` drawn uniformly from {1, 2, 3, 5, 7}.
- It carries four random numbers drawn once and shared by every policy (common random numbers): `U_open`, `U_drag`, `U_coin`, `U_see`, uniform on (0, 1), and two standard normal draws used by the pick model.

Each student also has a lecture timetable. For each weekday, a number of lecture bands `k` is drawn (1 with probability 0.2, 2 with 0.6, 3 with 0.2) from three bands:
07:30 to 11:15, 13:00 to 16:30 and 16:45 to 20:00. Each band holds four 50-minute periods, evenly spaced. The timetable is the same every week. Lectures are busy time that no policy may overlap.
Placed tasks do not occupy the calendar.

### 3.2 Parameters

Every value below is an assumption, except the production constants of the policies in section 2.

| Quantity | Value | Where it varies |
| --- | --- | --- |
| Tasks per student | 12 | fixed |
| Task length | 60 minutes | fixed |
| Attention `a` | 0.5 in the band grid | 0.05, 0.15, 0.3, 0.6, 0.9 in the attention worlds; 0.02 in the absent world |
| Deadline boost | `a` is multiplied by 1.5 (capped at 1) within 2 days of the deadline | fixed |
| Drag chance `q` | 0.3 | fixed |
| Share of drag, tap, ignore students | 10%, 60%, 30% | sensitivity rows (section 5.7) |
| Pick noise `sigma`, keep bias `beta` | 0.3, 0.15 | fixed until classroom labels exist |
| True band | 09 to 17, 06 to 10, 13 to 17, 17 to 21, 21 to 24 | the band worlds |
| Stated band | correct or wrong (see the Glossary) | the band worlds |

The 17 worlds are the groups we chose to probe. They are not a sample from a population of students.

| Group | Worlds |
| --- | --- |
| Band grid (10) | five true bands, each with a correct and a wrong stated band, attention 0.5 |
| Attention sweep (5) | true band 17 to 21, correct stated band, attention 0.05, 0.15, 0.3, 0.6, 0.9 |
| Absent (1) | true band 17 to 21, correct stated band, attention 0.02 |
| Routine change (1) | true band 17 to 21 for the first 14 days and 06 to 10 after, stated band evening throughout |

### 3.3 When a block starts, and what a bad placement is

Let a block start at clock hour `h(s)` on its day, and let `d(s)` be the days from the block's start to the deadline. The student's true band is `[lo, hi)`. Define:

```text
in(s)  = 1 if lo <= h(s) < hi, else 0          (only the start hour is tested)
p(s)   = min(1, a * 1.5) if d(s) <= 2, else a    (the chance the student opens the app in the block)
```

The task's fixed draw `U_open` is compared with `p`:

- **In band.** The task is started if `U_open < p(s)`.
- **Out of band, ignore or tap student.** The task is not started.
- **Out of band, drag student.** If `U_drag < q` (0.3) and a free in-band start exists on that day (a 15-minute start inside the band, not overlapping a lecture, not in 02:00 to 06:00), the student moves the block to the one
  nearest the band centre. The task is then started if `U_open < p(s)`, with `p` taken from the original slot. Otherwise it is not started.

So the probability that a placed block leads to a start is

```text
P(start | block at s) = in(s) * p(s)                                            ignore and tap students
                      = in(s) * p(s)  +  (1 - in(s)) * q * f(s) * p(s)           drag students (f = 1 if a free in-band start exists)
```

**A bad placement, in this report, is a block that starts outside the student's true band.** Its start probability is 0 for 90% of students (the ignore and tap students) and at most `q * p(s)`,
that is 0.3 times `p`, for drag students. A good placement is in band, and a better one is in band and within 2 days of the deadline, because `p` is then 1.5 times larger (unless that is capped at 1).
There is no other notion of quality: no regret, no utility curve, no sleep penalty. This is a simplification, and it decides which policy wins.

A student's score for a policy is the sum of the 12 task outcomes (1 started, 0 not). A task that a policy cannot place counts as not started.

### 3.4 The three kinds of student and the live protocol

Each student is one of three kinds, drawn once with probabilities 0.1, 0.6, 0.3. The draw uses the student's own seed, so every policy sees the same kind.

- **Drag:** may move an out-of-band block (section 3.3).
- **Tap:** answers the offer in the live protocol below, and does nothing else.
- **Ignore:** never moves a block and never answers an offer.

In the single-policy arms only drag students ever change a block. The live protocol (arm **AB**) adds the pairwise offer. For every task:

1. A seeded coin `U_coin < 0.5` makes LinUCB the primary policy, otherwise the heuristic. Both policies place the task.
2. If the two starts are at least 60 minutes apart, the student is shown the choice. Otherwise there is no offer.
3. A tap student sees the offer with probability `p` of the primary's slot (`U_see < p`). Others never answer. If the offer is not answered the primary's block stands.
4. A tap student who sees it takes the alternative when `u_alt + sigma * e_alt > u_prim + beta + sigma * e_prim`, where `e` are standard normal draws and the utility of a start is
   `u(s) = 1` if `s` is in band, otherwise `-min(1, d / 6)` with `d` the hours from the nearest band edge. This is the probability `Phi((u_alt - u_prim - beta) / (sigma * sqrt(2)))` of taking the alternative.
5. The applied block then goes through the start rule of section 3.3. Learning follows the reward table in section 2.2.

### 3.5 What the student model leaves out

Real students vary in many ways this model does not: a continuous preferred hour, weekday and weekend differences, tiredness, how late they start, other commitments, and unequal liking within a band.
The start rule is binary and depends only on the start hour. Exams, assignments and other placed tasks do not occupy the calendar. These choices make the model easy to state and to check, but they are not measured.

## 4. Metrics and statistics

### 4.1 Starts per student

For student `i`, policy `a` and world `w`, the score is

```text
X(a, i) = sum over the 12 tasks of  1[task is started]
```

as defined in section 3.3. The tables report the mean `X-bar(a) = (1/n) * sum X(a, i)` over the `n` students of the world (`n = 3,000` in the main run: 30 seeds with 100 students each).
The mean has no interval by itself, only differences do. Example, world 09 to 17 with a correct band: `X-bar(S) = 7.67`, `X-bar(H1) = 7.20`. A mean of 7.20 means the average student starts 7.2 of the 12 tasks.

### 4.2 The difference between two policies, and why pairing matters

For two policies `A` and `B` on the same student:

```text
D(i) = X(A, i) - X(B, i)         D-bar = (1/n) * sum D(i)
```

Both policies get the same student: the same tasks, the same calendar, the same kind of student and the same random numbers `U_open`, `U_drag`, `U_coin`, `U_see`. Only the placements differ. This is called pairing.

Worked example, S minus H1, world 09 to 17 with a correct band, `n = 3,000`:

- `D-bar = 0.468`. The standard deviation of `D` is 0.687 and the standard error is `0.687 / sqrt(3000) = 0.0125`.
- `D(i) > 0` for 37% of students, `D(i) = 0` for 63%, and `D(i) < 0` for none. LinUCB never starts fewer tasks than H1 for one of these students.
- Pairing matters: `X(S)` and `X(H1)` have standard deviations of 1.65 and 1.68 but are correlated at 0.91, so `D` has a standard deviation of only 0.69. Without pairing the standard error would be
  `sqrt(1.65^2 + 1.68^2) / sqrt(3000) = 0.043`, 3.4 times larger.

### 4.3 How the intervals are established

All intervals are 95% percentile bootstrap intervals with 2,000 resamples and a fixed random seed, so a rerun gives the same numbers. A difference is printed as
`mean [lo, hi] / [lo, hi]`. There are two intervals because there are two ways the result could differ in a new run.

**Interval over students (the first bracket).**

1. Take the `n` values `D(1), ..., D(n)`.
2. Draw `n` values from them with replacement and compute their mean. Repeat 2,000 times.
3. Report the 2.5th and 97.5th percentiles of the 2,000 means.

It answers: how much would the mean change with a different draw of students from the same world? Check against theory: the normal-theory interval `0.468 +/- 1.96 * 0.0125` is [0.443, 0.493]. The bootstrap gives [0.443, 0.492].

**Interval over seeds (the second bracket).**

1. Split the 3,000 students into the 30 seeds of 100. Compute each seed's mean of `D`. These 30 values lie between 0.35 and 0.61 in the example, with standard deviation 0.077.
2. Draw 30 values from them with replacement and take their mean. Repeat 2,000 times.
3. Report the 2.5th and 97.5th percentiles.

It answers: how much would the mean change in a new run of 30 seeds? Students are independent draws, so this interval is a consistency check on the first. The two agree throughout the report, which is what independent students predict.

**Rates (offered, tapped, pick, start by primary policy).** Each is a ratio of sums over students, for example the pick rate `sum(picks_i) / sum(taps_i)`. The interval resamples whole students with replacement, recomputes the ratio, and takes the
2.5th and 97.5th percentiles. Resampling students, not individual offers, accounts for several offers coming from one student.

**What the intervals do not cover.** They measure sampling variation only. They do not cover the assumptions of section 3: a different student model would shift the means by far more than any interval shows. No p-values are reported, and no correction for
looking at 17 worlds is applied, because the verdicts are read from the size of the effect and not from a test.

### 4.4 The offer metrics

These come from the live protocol (arm AB), counted over every task of every student in a world. In the example world there are 36,000 events (30 seeds x 100 students x 12 tasks).

| Metric | Definition | Example, world 09 to 17 with a correct band |
| --- | --- | --- |
| Offered rate | events with an offer / all events. An offer needs the two starts to be at least 60 minutes apart. | 29,941 / 36,000 = 83% |
| Tapped rate | offers answered / offers shown. Only tap students answer, and only when they see it. | 10,612 / 29,941 = 35% |
| Pick rate | answered offers where the student chose LinUCB's block / answered offers. 50% means no preference. | 4,944 / 10,612 = 47% |
| Start, LinUCB primary | events with LinUCB as primary policy whose applied block was started / events with LinUCB as primary. | 11,213 / 17,916 = 63% |
| Start, heuristic primary | the same for events with the heuristic as primary. | 10,940 / 18,084 = 60% |

The pick rate is the simulated counterpart of the classroom labelling session. It depends on the assumed choice model (section 3.4), so it is a consistency check on the start results and not a result of its own.

### 4.5 The verdict, and the margin

The margin is 0.5 starts per student, about one task in 24. It is our judgement of what a student would notice. The verdict for a difference `S - H1` uses the wider of the two intervals:

- **better** if both ends are above 0;
- **worse** if both ends are below 0 and the lower end is below -0.5;
- **slightly worse** if both ends are below 0 and the lower end is above -0.5;
- **level** if the interval includes 0.

"Better" and "worse" describe the sign of a difference that is distinguishable from sampling noise. They do not say the difference is large: the 13 to 17 wrong-band world is "better" by 0.03 starts.

### 4.6 Checks run before any result is read

`tests/test_evalx.py` checks that the harness places exactly what `/v1/place` places, that the rewards equal the backend constants, that a seed reruns to identical output, that a policy compared with itself differs
by exactly 0, that Oracle is at least every other policy and Rand is below S, and that with no keep bias the pick is a fair coin.

## 5. Results

### 5.1 LinUCB (S) against the heuristic with the same band (H1)

This section subtracts H1's starts per student from S's, world by world, on the same students and draws. H1 is the right rival because it has the same input as LinUCB, the stated band.
A positive difference means LinUCB starts more tasks. Both intervals and the verdict follow section 4.3 and 4.5.

| World | H1 | S | S - H1 | Verdict |
| --- | --- | --- | --- | --- |
| 09 to 17, correct | 7.20 | ***7.67*** | +0.47 [+0.44, +0.49] / [+0.44, +0.49] | better |
| 09 to 17, wrong | 0.23 | ***0.57*** | +0.34 [+0.30, +0.38] / [+0.30, +0.38] | better |
| 6 to 10, correct | 6.03 | ***6.26*** | +0.23 [+0.21, +0.24] / [+0.21, +0.24] | better |
| 6 to 10, wrong | 0.23 | ***0.49*** | +0.26 [+0.22, +0.29] / [+0.22, +0.29] | better |
| 13 to 17, correct | 0.17 | ***6.22*** | +6.05 [+5.97, +6.13] / [+5.96, +6.13] | better |
| 13 to 17, wrong | 0.12 | ***0.15*** | +0.03 [+0.01, +0.04] / [+0.01, +0.04] | better |
| 17 to 21, correct | ***7.20*** | 6.24 | -0.96 [-1.01, -0.90] / [-1.02, -0.90] | worse |
| 17 to 21, wrong | 0.24 | ***0.39*** | +0.15 [+0.12, +0.17] / [+0.13, +0.17] | better |
| 21 to 24, correct | ***7.20*** | 6.47 | -0.73 [-0.77, -0.68] / [-0.77, -0.69] | worse |
| 21 to 24, wrong | 0.24 | ***0.41*** | +0.17 [+0.14, +0.19] / [+0.14, +0.19] | better |
| attention 0.05 | ***0.71*** | 0.61 | -0.11 [-0.12, -0.09] / [-0.12, -0.09] | slightly worse |
| attention 0.15 | ***2.16*** | 1.87 | -0.29 [-0.32, -0.26] / [-0.31, -0.27] | slightly worse |
| attention 0.3 | ***4.29*** | 3.73 | -0.57 [-0.61, -0.53] / [-0.61, -0.53] | worse |
| attention 0.6 | ***8.64*** | 7.48 | -1.16 [-1.23, -1.10] / [-1.24, -1.10] | worse |
| attention 0.9 | ***11.28*** | 9.49 | -1.79 [-1.85, -1.73] / [-1.86, -1.72] | worse |
| absent | ***0.23*** | 0.19 | -0.05 [-0.05, -0.04] / [-0.05, -0.04] | slightly worse |
| routine change | ***3.72*** | 3.30 | -0.42 [-0.46, -0.39] / [-0.47, -0.38] | slightly worse |

Worlds with a wrong band score near 0 for both policies, so their differences are small in size even when they are clear.

### 5.2 Where the policies place blocks

Section 5.1 gives the result but not the reason. This section measures where each policy puts its blocks. For each world, 200 students (seed 0, ignore style so no block is moved) place their 12 tasks. The table reports three
numbers per policy: the share of blocks that start inside the student's true band, the mean start hour, and the share that start within 2 days of their deadline (where `p` is boosted).
The code is `python -m evalx.diagnose`.

| World | In band, H1 | In band, S | Mean start hour, H1 | Mean start hour, S | Within 2 days of deadline, H1 | Within 2 days of deadline, S |
| --- | --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 100% | 100% | 12.0 | 13.4 | 41% | 56% |
| 09 to 17, wrong | 0% | 0% | 21.0 | 21.2 | 41% | 54% |
| 6 to 10, correct | 81% | 81% | 8.6 | 9.3 | 51% | 58% |
| 6 to 10, wrong | 0% | 0% | 18.4 | 18.3 | 41% | 61% |
| 13 to 17, correct | 0% | 83% | 12.0 | 14.1 | 41% | 58% |
| 13 to 17, wrong | 0% | 0% | 21.0 | 21.2 | 41% | 54% |
| 17 to 21, correct | 100% | 83% | 18.4 | 18.3 | 41% | 57% |
| 17 to 21, wrong | 0% | 0% | 8.6 | 9.3 | 51% | 59% |
| 21 to 24, correct | 100% | 87% | 21.0 | 21.2 | 41% | 53% |
| 21 to 24, wrong | 0% | 0% | 8.6 | 9.3 | 51% | 59% |
| attention 0.05 | 100% | 83% | 18.4 | 18.3 | 41% | 60% |
| attention 0.15 | 100% | 83% | 18.4 | 18.3 | 41% | 59% |
| attention 0.3 | 100% | 83% | 18.4 | 18.3 | 41% | 58% |
| attention 0.6 | 100% | 83% | 18.4 | 18.3 | 41% | 57% |
| attention 0.9 | 100% | 83% | 18.4 | 18.3 | 41% | 57% |
| absent | 100% | 83% | 18.4 | 18.3 | 41% | 60% |
| routine change | 50% | 41% | 18.4 | 18.3 | 41% | 58% |

What the table shows:

- **13 to 17, correct band.** H1 places 100% of its blocks at 12:00. The stated afternoon band is 12 to 17, its table is flat at 1.0 across it, and the earliest block wins ties, so 12:00 (free before the 13:00 lectures) always wins. The student starts at 13:00, so none of
  these blocks starts. LinUCB places 83% of its blocks in band. This explains the +6.05.
- **09 to 17, correct band.** Both policies place 100% in band. LinUCB's +0.47 comes from timing: 56% of its blocks start within 2 days of the deadline against 41%, and `p` is 1.5 times larger there.
  The gain is a property of the assumed student, who is more likely to open the app near a deadline.
- **17 to 21 and 21 to 24, correct band, and high attention.** H1 places 100% in band. LinUCB places 83% to 87% in band, the rest at 21:00 for the evening student or 20:00 for the night student, just outside the band. Those blocks cost starts.
  LinUCB's closeness to the deadline (53% to 57% of its blocks against 41%) recovers part of the loss, and less so at attention 0.9, where `p` is already near its cap of 1.
- **06 to 10, correct band.** Both policies place 81% of blocks in band, because the student's band overlaps the morning lectures. The +0.23 is again timing: 58% of LinUCB's blocks start within 2 days of the deadline against 51%.
- **Every wrong-band world.** Both policies place 0% of blocks in band, since both follow the wrong stated hours. The few starts that remain come only from drag students moving a block (section 3.3), which is why these worlds score near 0 for both.
  LinUCB's small lead there is timing again: it places more blocks near the deadline, and a moved block keeps the start probability of its original slot.
- **Routine change.** Over the whole run H1 places 50% and S 41% in band, since the stated band stays evening after the student's band moves to 06 to 10.

### 5.3 Against the default heuristic (H0) and the controls

This section compares S with H0, the heuristic that skipped onboarding, and shows L0, Oracle and Rand beside it. S minus H0 mixes two effects: the value of knowing the stated band and the value of LinUCB.
Section 5.1 isolates LinUCB. Oracle bounds every row from above and Rand from below.

| World | H0 | L0 | Oracle | Rand | S - H0 |
| --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 6.83 | 4.96 | 9.02 | 4.66 | +0.84 [+0.80, +0.88] |
| 6 to 10, correct | 6.04 | 3.94 | 9.02 | 1.36 | +0.23 [+0.21, +0.24] |
| 13 to 17, correct | 0.94 | 1.40 | 7.07 | 2.37 | +5.28 [+5.20, +5.36] |
| 17 to 21, correct | 0.96 | 3.29 | 9.02 | 2.49 | +5.29 [+5.21, +5.36] |
| 21 to 24, correct | 0.25 | 4.76 | 9.02 | 0.82 | +6.22 [+6.15, +6.29] |
| 09 to 17, wrong | 6.83 | 4.96 | 9.02 | 4.66 | -6.26 [-6.34, -6.17] |
| 6 to 10, wrong | 6.04 | 3.94 | 9.02 | 1.36 | -5.55 [-5.63, -5.46] |

- With a correct band, LinUCB gains 5.3 to 6.2 starts against H0 for afternoon, evening and night students, and 0.2 to 0.8 for students whose hours the default table already covers (06 to 10, 09 to 17).
- With a wrong band it loses 5.6 to 6.3 against H0 where H0's default table already fits. A wrong stated band hurts LinUCB and H1 alike (section 5.1).

### 5.4 Every arm, starts per student

This section prints the mean starts per student of every arm in every world, so any pair can be compared. There are no differences or intervals here. Read each row between Rand (floor) and Oracle (ceiling). Bold italic marks the best of the seven policy arms.
S-gap, S-deadline and S-tiebreak are S with one part off.

| World | H0 | H1 | L0 | S | S-gap | S-deadline | S-tiebreak | Oracle | Rand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 6.83 | 7.20 | 4.96 | 7.67 | 7.65 | ***7.73*** | 7.67 | 9.02 | 4.66 |
| 09 to 17, wrong | ***6.83*** | 0.23 | 4.96 | 0.57 | 0.51 | 0.56 | 0.57 | 9.02 | 4.66 |
| 6 to 10, correct | 6.04 | 6.03 | 3.94 | 6.26 | 6.26 | ***6.82*** | 6.26 | 9.02 | 1.36 |
| 6 to 10, wrong | ***6.04*** | 0.23 | 3.94 | 0.49 | 0.48 | 1.72 | 0.50 | 9.02 | 1.36 |
| 13 to 17, correct | 0.94 | 0.17 | 1.40 | 6.22 | 6.15 | ***6.34*** | 6.22 | 7.07 | 2.37 |
| 13 to 17, wrong | 0.94 | 0.12 | ***1.40*** | 0.15 | 0.14 | 0.15 | 0.14 | 7.07 | 2.37 |
| 17 to 21, correct | 0.96 | ***7.20*** | 3.29 | 6.24 | 6.48 | 6.30 | 6.24 | 9.02 | 2.49 |
| 17 to 21, wrong | 0.96 | 0.24 | ***3.29*** | 0.39 | 0.38 | 0.40 | 0.35 | 9.02 | 2.49 |
| 21 to 24, correct | 0.25 | 7.20 | 4.76 | 6.47 | 5.33 | ***7.64*** | 6.47 | 9.02 | 0.82 |
| 21 to 24, wrong | 0.25 | 0.24 | ***4.76*** | 0.41 | 0.37 | 0.45 | 0.36 | 9.02 | 0.82 |
| attention 0.05 | 0.08 | ***0.71*** | 0.14 | 0.61 | 0.67 | 0.61 | 0.61 | 0.89 | 0.25 |
| attention 0.15 | 0.28 | ***2.16*** | 0.61 | 1.87 | 2.01 | 1.88 | 1.87 | 2.69 | 0.74 |
| attention 0.3 | 0.57 | ***4.29*** | 1.60 | 3.73 | 3.94 | 3.75 | 3.73 | 5.37 | 1.48 |
| attention 0.6 | 1.14 | ***8.64*** | 4.24 | 7.48 | 7.75 | 7.54 | 7.48 | 10.83 | 2.97 |
| attention 0.9 | 1.30 | ***11.28*** | 5.76 | 9.49 | 9.69 | 9.52 | 9.49 | 12.00 | 3.59 |
| absent | 0.02 | ***0.23*** | 0.03 | 0.19 | 0.21 | 0.19 | 0.19 | 0.23 | 0.07 |
| routine change | 3.44 | ***3.72*** | 2.68 | 3.30 | 3.48 | 3.61 | 3.30 | 9.02 | 1.95 |

- Below Rand with a correct band: H0 in the afternoon, evening and night worlds, and H1 and L0 in the afternoon world.
- With a wrong band, H1 and every S variant fall below Rand in every world except S-deadline in the 06 to 10 world (1.72 against 1.36), because they follow the wrong hours. L0 does not use the band.
- S-deadline is the best policy arm in four correct-band worlds (09 to 17, 06 to 10, 13 to 17, 21 to 24) and beats H1 in each. H1 stays best in the evening world and in the attention, absent and routine-change worlds.
- S-gap differs from S by under 0.3 except in the night world (5.33 against 6.47). S-tiebreak differs by under 0.1 everywhere.
- H1 and H1-deadline score the same in every world, so the deadline term does nothing to the heuristic and the S-deadline gain is LinUCB's own.
- Only H1 in the absent world matches Oracle (0.23). In the correct-band worlds the best arm is 0.2 to 5.3 starts below Oracle, and the routine-change world is the widest.

### 5.5 What each part of LinUCB adds

This section asks which parts of S earn their place. Each column is S minus S with that part switched off, in starts per student, so a positive value means the part helps. The prior is switched off by comparing S with L0. The table shows the five correct-band worlds,
the 0.9 attention world and the routine-change world; every world and interval is in the eval output (`evalx/out/report.md`).

| World | Prior (S - L0) | Gap quality | Deadline term | Tie-break |
| --- | --- | --- | --- | --- |
| 09 to 17 | +2.70 | +0.01 | -0.06 | 0.00 |
| 6 to 10 | +2.32 | 0.00 | -0.56 | 0.00 |
| 13 to 17 | +4.82 | +0.07 | -0.12 | 0.00 |
| 17 to 21 | +2.95 | -0.24 | -0.06 | 0.00 |
| 21 to 24 | +1.71 | +1.14 | -1.17 | 0.00 |
| attention 0.9 | +3.73 | -0.20 | -0.02 | 0.00 |
| routine change | +0.62 | -0.18 | -0.31 | 0.00 |

- The prior is positive with a correct band in all 5 band worlds (+1.7 to +4.8) and negative with a wrong band in all 5 (-1.3 to -4.4).
- Gap quality is near 0 in most worlds, +1.14 for the night student, -0.24 for the evening student and -0.20 at attention 0.9.
- The deadline term has an interval below 0 in 13 of 17 worlds and is never positive beyond +0.01.
- The tie-break is 0.00 with a correct band and within 0.05 of 0 with a wrong one.

![Ablation by world](./figures/eval-f2-ablation.png)

### 5.6 The pairwise offer

This section reports the live protocol of section 3.4 for the same students. Its purpose is to check whether the simulated students' stated choice between the two policies' times agrees with the start results. The metrics are defined and worked in section 4.4.
A pick rate above 50% favours LinUCB's time.

| World | Offered | Tapped | LinUCB pick rate | Start, LinUCB primary | Start, heuristic primary |
| --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 83% | 35% | 47% [45, 48] | 63% | 60% |
| 6 to 10, correct | 78% | 38% | 38% [37, 39] | 50% | 52% |
| 13 to 17, correct | 94% | 37% | 91% [90, 91] | 51% | 20% |
| 17 to 21, correct | 91% | 37% | 27% [26, 28] | 54% | 60% |
| 21 to 24, correct | 53% | 40% | 21% [20, 22] | 55% | 60% |
| attention 0.05 | 90% | 4% | 34% [31, 37] | 5% | 6% |
| attention 0.9 | 92% | 57% | 27% [26, 28] | 88% | 94% |
| routine change | 92% | 37% | 51% [50, 52] | 34% | 34% |
| 09 to 17, wrong | 61% | 39% | 74% [73, 74] | 14% | 9% |

- Where LinUCB wins on starts (13 to 17) its time is chosen 91% of the time. Where it loses (evening, night, high attention) it is chosen 21% to 28%.
- 06 to 10 and 09 to 17 disagree: LinUCB wins on starts but its time is chosen only 38% and 47% of the time. In those worlds both policies place in band and the choice model has little to separate them.
- Most offers are not answered. At attention 0.05 only 4% are, so few picks reach LinUCB.
- With a wrong band both policies are poor, and LinUCB's time is chosen 61% to 74% of the time. It is the less bad option.

### 5.7 Sensitivity to the assumptions

This section changes one assumption per row and reports S minus H1 and the pick rate again, to see whether the verdict survives. It uses seeds 100 to 109 with 1,000 students per world, averaged over the five band worlds with a correct stated band
and the five with a wrong stated band (equal weight). The averages hide which world drives them: in the production row the correct-band average of +1.03 is carried by the afternoon world (+6.05), so compare rows with each other and do not read the level.
The pick rate is pooled over the same five worlds.

| Row | What changes | S - H1, correct-band worlds | S - H1, wrong-band worlds | Pick rate, correct-band worlds | Pick rate, wrong-band worlds |
| --- | --- | --- | --- | --- | --- |
| production | Production settings: 10% drag, 60% tap, 30% ignore; LinUCB alpha 0.15; heuristic as shipped | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 46% [44, 47] | 65% [65, 66] |
| mix: drag_only | Every student is a dragger | +0.86 [+0.82, +0.90] | +1.90 [+1.83, +1.97] | n/a (no tappers) | n/a (no tappers) |
| mix: move_heavy | 60% drag, 10% tap, 30% ignore | +0.93 [+0.89, +0.97] | +1.17 [+1.08, +1.25] | 44% [41, 48] | 64% [62, 65] |
| mix: ignore_heavy | 10% drag, 20% tap, 70% ignore | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 47% [45, 49] | 66% [65, 67] |
| alpha 0.05 | LinUCB exploration weight 0.05 (shipped 0.15) | +1.06 [+1.02, +1.10] | +0.15 [+0.11, +0.18] | 48% [46, 49] | 63% [63, 64] |
| alpha 0.5 | LinUCB exploration weight 0.5 | +1.08 [+1.04, +1.11] | +0.30 [+0.26, +0.34] | 36% [35, 37] | 71% [70, 72] |
| heuristic rate 0.05 | Heuristic table learning rate 0.05 (shipped 0.2) | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 46% [44, 47] | 65% [65, 66] |
| heuristic rate 0.5 | Heuristic table learning rate 0.5 | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.18] | 46% [44, 47] | 65% [65, 66] |
| heuristic rate 2 | Heuristic table learning rate 2 | +1.03 [+0.99, +1.07] | +0.12 [+0.09, +0.15] | 46% [44, 47] | 65% [65, 66] |
| heuristic kept weight 0 | A kept or started slot adds 0 to the table (shipped 0.25) | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 46% [44, 47] | 65% [65, 66] |
| heuristic kept weight 1 | A kept or started slot adds 1 | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 46% [44, 47] | 65% [65, 66] |
| heuristic outside 0 | H1 table value outside the stated band 0 (shipped 0.2) | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 46% [44, 47] | 65% [65, 66] |
| heuristic outside 0.5 | H1 table value outside the stated band 0.5 | +1.03 [+0.99, +1.07] | +0.15 [+0.11, +0.19] | 46% [44, 47] | 65% [65, 66] |
| heuristic outside 0.8 | H1 table value outside the stated band 0.8 | +1.03 [+0.99, +1.07] | +0.12 [+0.09, +0.15] | 46% [44, 47] | 65% [65, 66] |
| heuristic outside 1 (flat) | H1 table value outside the band 1.0, the same as inside: the band is ignored | +5.05 [+4.98, +5.13] | -2.01 [-2.07, -1.95] | 87% [86, 88] | 49% [48, 50] |
| gap weight 0 | LinUCB gap-quality weight 0 (shipped 0.2) | +0.82 [+0.77, +0.86] | +0.13 [+0.10, +0.16] | 46% [44, 47] | 65% [65, 66] |
| deadline weight 0 | Deadline weight 0 for both policies (shipped 0.2) | +1.41 [+1.37, +1.45] | +0.40 [+0.35, +0.44] | 46% [44, 47] | 65% [65, 66] |

- Starts follow the share of dragging students, because in the single-policy arms only drag students act. With all students dragging, LinUCB's lead over H1 is larger when the band is wrong (+1.90), since it learns from moves faster.
- Alpha from 0.05 to 0.5 barely moves S minus H1. Alpha 0.5 lowers the pick rate to 36% with a correct band.
- Deadline weight 0 raises S minus H1 by 0.38 (correct band) and 0.24 (wrong band). H1 scores the same with and without the term (section 5.4), so the gain is LinUCB's.
- The heuristic's learning rate (0.05 to 2), kept-slot weight (0 to 1) and band trust, the table value outside the band (0 to 0.8), change S minus H1 by 0.03 or less. We checked the settings are wired: a rate of 5 or a flat table changes the outcome.
  Over 12 tasks the table moves one cell at a time and the band's hours already sit at the cap of 1.0, so moderate settings do not change what it proposes.
- A flat table (outside value 1.0) ignores the stated band. It is the one heuristic setting that matters, and it trades one case for the other: S minus H1 becomes +5.05 with a correct band and -2.01 with a wrong band.
  No heuristic setting tested beats LinUCB with a correct band and also holds up with a wrong one.

![Sensitivity](./figures/eval-f3-sensitivity.png)

### 5.8 Does the sample size matter?

This section reruns the main comparison with 600 students per world (an earlier run of the same 30 seeds) and sets it beside the 3,000-student main run. It shows how much of the result is sampling noise.
The width is the upper minus the lower end of the interval over students.

| World | S - H1, 3000 students | Width | Verdict | S - H1, 600 students | Width | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | +0.47 | 0.05 | better | +0.47 | 0.11 | better |
| 09 to 17, wrong | +0.34 | 0.08 | better | +0.34 | 0.19 | better |
| 6 to 10, correct | +0.23 | 0.04 | better | +0.25 | 0.09 | better |
| 6 to 10, wrong | +0.26 | 0.07 | better | +0.22 | 0.14 | better |
| 13 to 17, correct | +6.05 | 0.16 | better | +6.02 | 0.35 | better |
| 13 to 17, wrong | +0.03 | 0.03 | better | +0.02 | 0.07 | level |
| 17 to 21, correct | -0.96 | 0.11 | worse | -0.90 | 0.24 | worse |
| 17 to 21, wrong | +0.15 | 0.04 | better | +0.13 | 0.09 | better |
| 21 to 24, correct | -0.73 | 0.09 | worse | -0.73 | 0.21 | worse |
| 21 to 24, wrong | +0.17 | 0.05 | better | +0.15 | 0.11 | better |
| attention 0.05 | -0.11 | 0.03 | slightly worse | -0.10 | 0.07 | slightly worse |
| attention 0.15 | -0.29 | 0.06 | slightly worse | -0.23 | 0.12 | slightly worse |
| attention 0.3 | -0.57 | 0.08 | worse | -0.52 | 0.18 | worse |
| attention 0.6 | -1.16 | 0.12 | worse | -1.09 | 0.27 | worse |
| attention 0.9 | -1.79 | 0.12 | worse | -1.76 | 0.27 | worse |
| absent | -0.05 | 0.02 | slightly worse | -0.04 | 0.03 | slightly worse |
| routine change | -0.42 | 0.08 | slightly worse | -0.44 | 0.17 | worse |

- The width is 0.02 to 0.16 at 3,000 students and 0.03 to 0.35 at 600, about 2.2 times narrower, as the square root of 5 predicts for the standard error.
- The means move by 0.07 or less.
- 15 of 17 verdicts are identical. Two change at a boundary: the 13 to 17 wrong-band world is level at 600 and better at 3,000 (+0.02 and +0.03), and the routine-change world is worse at 600 and slightly worse at 3,000 (-0.44 and -0.42, on the -0.5 margin).
- More students narrow the intervals and leave the conclusions as they are. What limits the report is the assumed student, not the sample size.

## 6. What the results mean

**Why LinUCB beats the heuristic for the afternoon student.** The heuristic's table is flat across the stated afternoon band (12 to 17) and the earliest block wins ties, so it always picks 12:00, which is outside the student's 13 to 17 band (section 5.2).
LinUCB learns the 14:00 to 17:00 band and places 83% of its blocks inside it.

**Why LinUCB beats it by 0.47 for the 09 to 17 student.** Both policies place every block in band. The difference is timing. LinUCB places more blocks within 2 days of the deadline, and the student model makes a start 1.5 times likelier there.
This is a feature of the assumed student, not evidence that LinUCB chooses better hours.

**Why LinUCB is slightly ahead in every wrong-band world.** Both policies place every block outside the student's band (section 5.2), so only moved blocks start. LinUCB's lead of 0.03 to 0.34 is again timing, not better hours.

**Why LinUCB loses for evening and night students and at high attention.** The heuristic with a correct band places everything in band. LinUCB's bands are 3 to 4 hours wide and it explores, so 13% to 17% of its blocks land just outside the student's band (section 5.2).
The loss grows with attention (-0.11 at 0.05 to -1.79 at 0.9) because each missed block costs more when the student opens the app more often. At 0.9 it is a relative loss of about 16%.

**The deadline term costs starts.** It lowers starts by 0.3 to 1.2 in the morning, night and routine-change worlds and by under 0.2 elsewhere. A likely cause: it pushes blocks away from the deadline, while the student model rewards being within 2 days of it.
We have not measured the shift in timing. The term has not been checked against real behaviour.

**The prior matters in both directions.** A correct stated band is worth +1.7 to +4.8 starts, and a wrong one costs 1.3 to 4.4 and hurts the heuristic just as much. If the stated band is often wrong, neither policy is safe. The onboarding question matters more than the choice of policy.

## 7. Verdict

**Do not claim that LinUCB is better than a heuristic given the same band.** The offline eval supports a narrower statement:

- LinUCB is clearly better in 8 of 17 worlds and worse in 9 (5 past the margin, 4 within it).
- Its value comes from the stated-band prior. Giving the heuristic the same prior removes most of the gap, except where the heuristic's tie rule places it outside the student's band (the afternoon world).
- It is worse for evening and night students and for students who open the app often, because 13% to 17% of its blocks miss the band.
- The deadline term does not earn its place in this simulation. The gap term helps only the night student (+1.14) and is neutral or costs up to 0.27 elsewhere.

**What would change this:** a classroom pick rate well above 50%, or fitted student parameters that move the assumptions in section 3.2. The sensitivity run shows the start result moves with the share of students who drag.

**Limits.**

- The students are simulated. Band, attention, drag share and the pick model are assumptions, not fitted to data (section 3.5).
- A start is binary and depends on the start hour only. It does not model how late a student starts, or how well they study.
- Lectures fill the calendar. Exams, assignments and placed tasks do not.
- The stated band has four values and true bands are single ranges. The worlds are chosen, not a sample of a population.
- 12 tasks per student over 4 weeks is a short horizon for a learner.
- The hybrid model is not included.
- The main run reproduces from `uv run python -m evalx run --seeds 30 --students 100` on the bandit code at commit `f5d7155a`. The diagnostic is `uv run python -m evalx.diagnose`. Protocol: [eval-protocol.md](./eval-protocol.md).
