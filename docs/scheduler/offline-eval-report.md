# Report: heuristic vs LinUCB, offline eval with a same-band control

**Context.** Zenflow is a study planner. When a student adds a task or a new exam or assignment arrives, the app
places a session for it and may offer one alternative time. The student can start the session, ignore it,
move it, or tap the alternative. Before release we want to know whether the learning policy (LinUCB) places
sessions better than the rule-based one (the heuristic).

We compared them with simulated students, because the live test has too few users to decide this early
([A/B plan](./ab-testing.md)). The question is the fair one: LinUCB uses the focus band the student states at
onboarding, so the heuristic gets the same band.

1. **Heuristic (H1):** a table of favourite hours, seeded from the stated band, that learns from what the student does.
2. **LinUCB (S):** a learning method with one model per time band, a prior from the stated band, and two slot-level
   terms (free time around the slot, distance to the deadline). It is the version in production
   ([level-up report](./level-up-linucb-v2.md)).

**Terms used below.**

- *Proposal:* one slot the app places for one task.
- *Start:* the student starts the session in its slot. The only outcome this eval counts.
- *Stated band:* the focus band the student picks at onboarding: morning, afternoon, evening or late night.
- *True band:* the hours the simulated student really starts in. The stated band may match it (correct) or not (wrong).
- *World:* one kind of simulated student: a true band, a stated band and an attention level.
- *Pick rate:* of the offers a student taps, the share where they take LinUCB's option.

## 1. The answer in short

Starts per student over 4 weeks (12 tasks), held-out seeds, 600 students per world:

| | Worlds | Result |
| --- | --- | --- |
| LinUCB clearly better than H1 | 7 of 17 | three correct-band worlds (09 to 17, 06 to 10, 13 to 17) and four wrong-band worlds |
| Level | 1 of 17 | afternoon student, wrong band |
| LinUCB slightly worse (under 0.5 starts) | 3 of 17 | very low attention, absent |
| LinUCB worse (past the margin) | 6 of 17 | evening and night students with a correct band, attention 0.3 and above, routine change |

- **No overall win over the fair control.** LinUCB gains up to +6.0 starts in one world (afternoon, correct band) and
  loses up to 1.8 in another (attention 0.9). The worlds are chosen, so they are not averaged into one number.
- **The band prior is what LinUCB adds.** It is worth +1.8 to +4.9 starts when the band is right and costs
  1.2 to 4.2 when it is wrong. Without it (L0), LinUCB is behind H1 in four of the five correct-band worlds.
- **LinUCB loses where the heuristic is already near its best.** At attention 0.9 the heuristic starts 11.25 tasks and
  LinUCB 9.49, about 16% fewer.
- **The deadline term costs starts here.** Removing it helps in 11 of 17 worlds and never hurts by more than 0.02. Without it, LinUCB beats H1 in four of the five correct-band worlds.
- **The pick rate agrees with the start result in most worlds.** LinUCB's option is taken 22% to 29% of the time where it
  loses on starts (evening, night) and 91% where it wins (afternoon). It disagrees in 2 of 5 correct-band worlds.
- **Limit:** the students are invented. The results show how the policies behave under stated assumptions, not
  that real students will start more. Section 7 lists the limits.

![S minus H1 by world](./figures/eval-f1-by-world.png)

## 2. The two systems

**Heuristic (H1).**

- Keeps one liking score per weekday and hour (7 x 24 cells) and proposes the free slot with the best score.
- It starts from the stated band: 1.0 for the hours inside it, 0.2 elsewhere. H0 is the same heuristic with the
  default table (09:00 to 12:00 scores 1.0, 14:00 to 17:00 scores 0.5, 19:00 to 22:00 scores 0.2, the rest 0).
  H0 stands for a student who skipped onboarding.
- A drag moves the table toward the new hour. A start raises that hour by 0.25 of a start reward.

**LinUCB (S).**

- Six time bands: 00 to 08, 08 to 11, 11 to 14, 14 to 17, 17 to 20, 20 to 24. One small model per band predicts how
  well a task placed there goes, from days to the deadline, task length, how busy the day is and the weekday.
- **Prior.** The stated band seeds each band model before any data: bands inside it start at +0.5, bands outside at
  -0.2, worth 3 pseudo-observations.
- **Slot score.** Band prediction plus an uncertainty bonus (alpha 0.15), plus 0.2 x gap quality (free time on each
  side of the slot, up to an hour each), minus up to 0.2 as the slot nears the deadline (within 24 hours).
  Ties between bands break in a seeded order.
- **Rewards (ADR-0035).** A start gives +1. A move gives minus the drag in minutes over 240, capped at -1. Ignoring
  gives nothing. In the pairwise offer, taking or keeping LinUCB's option gives +0.5 and keeping the heuristic's
  option over it gives -0.2.
- Quiet hours (23:00 to 06:00) are a hard limit. For a late-night student they are 02:00 to 09:00.

**Controls.**

- L0: LinUCB with no stated band. S-gap, S-deadline, S-tiebreak: S with that part switched off.
- Oracle: the in-band free slot with the best chance of a start. Rand: a random day and hour in the task's window.
- AB: the live protocol (section 4).

## 3. How to read the numbers

- All outcomes are tasks started per student over the 4 weeks, so the ceiling is 12. Oracle reaches about 9 because attention is 0.5 in most worlds.
- Absolute values have no interval. Differences do. A difference reads `mean [95% CI over students] / [95% CI over seeds]`.
- **Over students:** resample the 600 students of a world 2,000 times. **Over seeds:** resample the 30 per-seed means
  2,000 times. The second covers run-to-run spread in the students and the learners.
- The two policies run on the same students, tasks and random draws, so each difference is paired.
- **Margin.** LinUCB is *non-inferior* when the lower end of both intervals on S minus H1 is above -0.5 starts. The margin
  is a judgement about what a student would notice.
- **Verdict** uses the wider of the two intervals: *better* if both ends are above 0; *worse* if both are below 0 and the
  lower end passes the margin; *slightly worse* if below 0 within the margin; otherwise *level*.
- Pick rates are a ratio of sums with a bootstrap by student, since one student's taps are correlated.
- A 50% pick rate means no preference between the two options.

## 4. How we tested

**Run.** Seeds 0 to 29, 20 students per seed, on committed code `f9f5278a`. An earlier run on an uncommitted tree gave
identical numbers. No constant was tuned; the Oracle and calendar were fixed on seeds 100 to 103, and seeds 100 to 109 give
the sensitivity runs.

**Worlds (17).**

| Group | Worlds |
| --- | --- |
| Band grid (10) | true bands 09 to 17, 06 to 10, 13 to 17, 17 to 21, 21 to 24, each with a correct and a wrong stated band |
| Attention sweep (5) | evening student, correct band, chance to open the app in a slot 0.05, 0.15, 0.3, 0.6, 0.9 |
| Absent (1) | evening student, attention 0.02 |
| Routine change (1) | evening student whose band moves to 06 to 10 after two weeks, stated band unchanged |

- Correct means the stated band whose centre is nearest the true centre. Wrong means the farthest.
- Attention is 0.5 in the band grid. It is raised to 1.5 times that within 2 days of a deadline.

**Tasks and calendar.**

- 12 tasks over 4 weeks. Each arrives at 08:00 on a random day, lasts 60 minutes, and is due 1, 2, 3, 5 or 7 days later.
- Each student has a weekday lecture timetable: 1 to 3 of three bands (07:30 to 11:15, 13:00 to 16:30, 16:45 to 20:00) with four 50-minute
  periods each, the same every week. Lectures are busy time. Placed tasks do not occupy the calendar.

**Student reaction (the assumption that matters most).**

- A student starts a block that lands in their true band if they open the app, with the chance above. Outside the band
  nothing happens, so ignoring gives no signal.
- Each student is one of three kinds, drawn once: *drag* (moves an out-of-band block to the nearest free in-band start 30% of
  the time), *tap* (answers offers), *ignore*. The headline mix is 10% drag, 60% tap, 30% ignore, the lazy-student mix of the
  level-up report. The sensitivity run varies it.

**The live protocol (AB).** Per event: a seeded coin picks the primary policy, both policies place the task, and an offer
appears when the two starts are at least 60 minutes apart. A tapper who sees it (chance equal to the open chance) compares
the two options by how close each is to their band, with noise 0.3 and a pull of 0.15 toward the primary. Closing the
offer keeps the primary. Learning follows the backend:

| Event | Effect on LinUCB |
| --- | --- |
| Takes LinUCB's option (either primary) | +0.5 |
| Keeps the heuristic's option over LinUCB's | -0.2, and the kept hour is reinforced |
| Takes the heuristic's option when LinUCB was primary | the move reward by distance |
| Start or move on LinUCB's slot | +1, or the move reward |

The noise and the pull are assumptions until the classroom labels exist.

**Gates run before any result is read** (`tests/test_evalx.py`): the harness places what `/v1/place` places; rewards equal the
backend constants; a seed reruns identically; an arm against itself differs by exactly 0; Oracle is at least every arm; Rand is
below S; with no bias the pick is 50%.

## 5. Results

### 5.1 LinUCB (S) against the heuristic with the same band (H1)

| World | H1 | S | S - H1 | Verdict |
| --- | --- | --- | --- | --- |
| 09 to 17, correct | 7.12 | ***7.58*** | +0.47 [+0.41, +0.52] / [+0.40, +0.54] | better |
| 09 to 17, wrong | 0.23 | ***0.56*** | +0.34 [+0.24, +0.43] / [+0.24, +0.44] | better |
| 06 to 10, correct | 5.99 | ***6.24*** | +0.25 [+0.21, +0.29] / [+0.21, +0.29] | better |
| 06 to 10, wrong | 0.23 | ***0.45*** | +0.22 [+0.16, +0.30] / [+0.15, +0.30] | better |
| 13 to 17, correct | 0.17 | ***6.18*** | +6.02 [+5.85, +6.20] / [+5.86, +6.19] | better |
| 13 to 17, wrong | 0.11 | 0.12 | +0.02 [-0.01, +0.05] / [-0.01, +0.05] | level |
| 17 to 21, correct | ***7.12*** | 6.22 | -0.90 [-1.02, -0.78] / [-0.99, -0.81] | worse |
| 17 to 21, wrong | 0.24 | ***0.37*** | +0.13 [+0.09, +0.18] / [+0.09, +0.18] | better |
| 21 to 24, correct | ***7.12*** | 6.39 | -0.73 [-0.84, -0.62] / [-0.82, -0.64] | worse |
| 21 to 24, wrong | 0.24 | ***0.39*** | +0.15 [+0.10, +0.21] / [+0.10, +0.21] | better |
| attention 0.05 | ***0.70*** | 0.60 | -0.10 [-0.14, -0.07] / [-0.13, -0.08] | slightly worse |
| attention 0.15 | ***2.11*** | 1.88 | -0.23 [-0.29, -0.18] / [-0.29, -0.18] | slightly worse |
| attention 0.3 | ***4.24*** | 3.72 | -0.52 [-0.61, -0.43] / [-0.62, -0.43] | worse |
| attention 0.6 | ***8.57*** | 7.48 | -1.09 [-1.24, -0.97] / [-1.19, -1.00] | worse |
| attention 0.9 | ***11.25*** | 9.49 | -1.76 [-1.90, -1.63] / [-1.88, -1.64] | worse |
| absent | ***0.24*** | 0.20 | -0.04 [-0.06, -0.03] / [-0.06, -0.02] | slightly worse |
| routine change | ***3.66*** | 3.22 | -0.44 [-0.53, -0.36] / [-0.52, -0.36] | worse |

Worlds with a wrong band and a student whose band the table cannot reach score near 0 for both policies, so their
differences are small in size even when clear.

### 5.2 Against the default heuristic (H0) and the controls

S minus H0 is the value of the band plus the value of LinUCB. S minus H1 above isolates LinUCB.

| World | H0 | L0 | Oracle | Rand | S - H0 |
| --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 6.75 | 4.80 | 8.97 | 4.71 | +0.83 [+0.73, +0.94] |
| 06 to 10, correct | 5.99 | 3.95 | 8.97 | 1.31 | +0.25 [+0.20, +0.29] |
| 13 to 17, correct | 0.90 | 1.31 | 7.02 | 2.42 | +5.29 [+5.12, +5.46] |
| 17 to 21, correct | 0.95 | 3.31 | 8.97 | 2.40 | +5.27 [+5.10, +5.44] |
| 21 to 24, correct | 0.24 | 4.62 | 8.97 | 0.81 | +6.15 [+6.00, +6.31] |
| 09 to 17, wrong | 6.75 | 4.80 | 8.97 | 4.71 | -6.19 [-6.38, -6.00] |
| 06 to 10, wrong | 5.99 | 3.95 | 8.97 | 1.31 | -5.54 [-5.72, -5.36] |

- Against H0, LinUCB with a correct band gains 5.3 to 6.2 starts for afternoon, evening and night students, and about
  0.25 to 0.8 for students whose hours the default table already covers (06 to 10, 09 to 17).
- With a wrong band it loses 5.5 to 6.2 against H0 where H0's default table already fits. The cost of a wrong stated band falls on
  LinUCB and H1 alike (section 5.1).
- Oracle is the ceiling in every world, which the gates check.

### 5.3 Every arm, starts per student

Oracle is the ceiling and Rand the floor. Bold italic is the best of the seven policy arms in a row. S-gap, S-deadline and
S-tiebreak are S with that part off. Intervals for the differences are in sections 5.1 and 5.4 and in the eval output.

| World | H0 | H1 | L0 | S | S-gap | S-deadline | S-tiebreak | Oracle | Rand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 6.75 | 7.12 | 4.80 | 7.58 | 7.60 | ***7.64*** | 7.58 | 8.97 | 4.71 |
| 09 to 17, wrong | ***6.75*** | 0.23 | 4.80 | 0.56 | 0.48 | 0.55 | 0.57 | 8.97 | 4.71 |
| 6 to 10, correct | 5.99 | 5.99 | 3.95 | 6.24 | 6.24 | ***6.79*** | 6.24 | 8.97 | 1.31 |
| 6 to 10, wrong | ***5.99*** | 0.23 | 3.95 | 0.45 | 0.45 | 1.57 | 0.46 | 8.97 | 1.31 |
| 13 to 17, correct | 0.90 | 0.17 | 1.31 | 6.18 | 6.01 | ***6.32*** | 6.18 | 7.02 | 2.42 |
| 13 to 17, wrong | 0.90 | 0.11 | ***1.31*** | 0.12 | 0.12 | 0.13 | 0.12 | 7.02 | 2.42 |
| 17 to 21, correct | 0.95 | ***7.12*** | 3.31 | 6.22 | 6.41 | 6.27 | 6.22 | 8.97 | 2.40 |
| 17 to 21, wrong | 0.95 | 0.24 | ***3.31*** | 0.37 | 0.36 | 0.37 | 0.34 | 8.97 | 2.40 |
| 21 to 24, correct | 0.24 | 7.12 | 4.62 | 6.39 | 5.32 | ***7.56*** | 6.39 | 8.97 | 0.81 |
| 21 to 24, wrong | 0.24 | 0.24 | ***4.62*** | 0.39 | 0.35 | 0.41 | 0.32 | 8.97 | 0.81 |
| attention 0.05 | 0.08 | ***0.70*** | 0.13 | 0.60 | 0.65 | 0.61 | 0.60 | 0.87 | 0.22 |
| attention 0.15 | 0.26 | ***2.11*** | 0.63 | 1.88 | 1.98 | 1.89 | 1.88 | 2.62 | 0.70 |
| attention 0.3 | 0.55 | ***4.24*** | 1.65 | 3.72 | 3.87 | 3.74 | 3.72 | 5.30 | 1.41 |
| attention 0.6 | 1.11 | ***8.57*** | 4.31 | 7.48 | 7.76 | 7.52 | 7.48 | 10.80 | 2.88 |
| attention 0.9 | 1.29 | ***11.25*** | 5.89 | 9.49 | 9.69 | 9.51 | 9.49 | 12.00 | 3.54 |
| absent | 0.02 | ***0.24*** | 0.04 | 0.20 | 0.21 | 0.20 | 0.20 | 0.24 | 0.07 |
| routine change | 3.42 | ***3.66*** | 2.63 | 3.22 | 3.41 | 3.54 | 3.23 | 8.97 | 1.88 |

- Below Rand with a correct band: H0 in the afternoon, evening and night worlds, and H1 and L0 in the afternoon world.
- With a wrong band, H1 and every S variant fall below Rand in every world, since they follow the wrong hours. L0 does not use the band.
- S-deadline is the best policy arm in four correct-band worlds (09 to 17, 06 to 10, 13 to 17, 21 to 24) and beats H1 in each.
  H1 stays best in the evening world and in the attention, absent and routine-change worlds.
- S-gap differs from S by under 0.2 except in the night world (5.32 against 6.39). S-tiebreak differs by under 0.1 everywhere.
- Only H1 in the absent world matches Oracle (0.24). In the correct-band worlds the best arm is 0.2 to 5.3 starts below it,
  and the routine-change world is the widest.

### 5.4 What each part of LinUCB adds

Starts per student, S minus S without the part. Rows for the five correct-band worlds; the figure includes the wrong-band worlds.

| World | Prior (S - L0) | Gap quality | Deadline term | Tie-break |
| --- | --- | --- | --- | --- |
| 09 to 17 | +2.78 | -0.01 | -0.06 | 0.00 |
| 06 to 10 | +2.29 | 0.00 | -0.56 | 0.00 |
| 13 to 17 | +4.88 | +0.18 | -0.13 | 0.00 |
| 17 to 21 | +2.90 | -0.19 | -0.05 | 0.00 |
| 21 to 24 | +1.77 | +1.07 | -1.17 | 0.00 |
| attention 0.9 | +3.60 | -0.20 | -0.02 | 0.00 |
| routine change | +0.59 | -0.19 | -0.31 | 0.00 |

Every world and every interval is in the eval output (`evalx/out/report.md`).

- **Prior:** positive with a correct band in all 5 worlds, negative with a wrong band in all 5.
- **Gap quality:** near 0 in most worlds, +1.07 for the night student, -0.19 for the evening student and -0.20 at attention 0.9.
- **Deadline term:** interval below 0 in 11 of 17 worlds; never positive beyond +0.02.
- **Tie-break:** 0.00 with a correct band, within 0.07 of 0 with a wrong one.

![Ablation by world](./figures/eval-f2-ablation.png)

### 5.5 Pairwise offer

Share of events offered, offers tapped, and how often a tap picks LinUCB's option. Start rates are per event by primary policy.

| World | Offered | Tapped | LinUCB pick rate | Start, LinUCB primary | Start, heuristic primary |
| --- | --- | --- | --- | --- | --- |
| 09 to 17, correct | 82% | 36% | 48% [46, 50] | 62% | 60% |
| 06 to 10, correct | 78% | 38% | 38% [36, 41] | 49% | 52% |
| 13 to 17, correct | 94% | 37% | 91% [89, 92] | 51% | 21% |
| 17 to 21, correct | 92% | 37% | 29% [26, 31] | 52% | 60% |
| 21 to 24, correct | 52% | 40% | 22% [19, 25] | 55% | 60% |
| attention 0.05 | 90% | 4% | 36% [30, 42] | 4% | 6% |
| attention 0.9 | 92% | 58% | 27% [25, 29] | 87% | 94% |
| routine change | 92% | 37% | 50% [48, 52] | 33% | 34% |
| 09 to 17, wrong | 59% | 39% | 73% [71, 74] | 13% | 8% |

- Where LinUCB wins on starts (afternoon) its option is taken 91% of the time. Where it loses (evening, night, high attention) it is taken 22% to 29%.
- 06 to 10 and 09 to 17 disagree: LinUCB wins on starts but its option is taken only 38% and 48% of the time.
- Most offers are not tapped. At attention 0.05 only 4% of offers are tapped, so few picks reach LinUCB.
- With a wrong band both policies are poor, and LinUCB's option is taken 59% to 73% of the time. It is the less bad option.

### 5.6 Sensitivity to the assumptions

Tuning seeds 100 to 109, the five band worlds. S minus H1 for the correct-band worlds and the wrong-band worlds, each averaged. The averages
depend on which worlds are included; read only the change between rows.

| Assumption | S - H1, correct band | S - H1, wrong band | Pick rate, correct | Pick rate, wrong |
| --- | --- | --- | --- | --- |
| production (10% drag, 60% tap, 30% ignore, alpha 0.15) | +0.99 | +0.15 | 47% | 65% |
| all students drag | +0.83 | +1.92 | n/a | n/a |
| 60% drag, 10% tap | +0.91 | +1.24 | 46% | 63% |
| 10% drag, 20% tap, 70% ignore | +0.99 | +0.15 | 47% | 66% |
| alpha 0.05 | +1.01 | +0.14 | 49% | 64% |
| alpha 0.5 | +1.01 | +0.30 | 36% | 70% |
| gap weight 0 | +0.75 | +0.13 | 47% | 65% |
| deadline weight 0 | +1.36 | +0.41 | 47% | 65% |

- In the single-policy arms only drag students act, so starts follow the drag share (the third and fourth rows match production).
- The mean of the correct-band worlds is carried by one world (afternoon, +6.0). It is not a population effect.
- Alpha 0.5 lowers the pick rate for LinUCB (36%) with the band right, likely because it explores more.
- Removing the deadline term raises S minus H1 by 0.37 (correct band) and 0.26 (wrong band).

![Sensitivity](./figures/eval-f3-sensitivity.png)

## 6. What the results mean

**Why LinUCB beats the heuristic for an afternoon student.**

- The student's hours are 13:00 to 17:00. The stated afternoon band is 12:00 to 17:00, so H1's table is flat across it and
  can place tasks at 12:00, just before lectures at 13:00. Those blocks fall outside the student's band and do not start.
- LinUCB's band models learn the 14:00 to 17:00 band quickly. This is a probable cause; we did not test it.

**Why it loses for evening and night students and at high attention.**

- The heuristic with a correct band is already near its best in these worlds, and its table resolves single hours.
  LinUCB's bands are three to four hours wide and it explores, so a share of its first placements likely miss the
  student's hours. We did not test this.
- The loss grows with attention (-0.10 at 0.05 to -1.76 at 0.9), because the more the student opens the app the more each
  missed placement costs. It is a relative loss of about 16% at 0.9.

**The deadline term is the part most clearly doing harm.**

- It lowers starts by 0.3 to 1.2 in the morning, night and routine-change worlds and by under 0.2 elsewhere. A likely
  cause: the simulator raises the chance of opening the app near a deadline, which the term pushes against.
- That is a property of the assumed student. The term has not been checked against real behaviour.

**The prior matters in both directions.**

- A correct stated band is worth +1.8 to +4.9 starts. A wrong one costs 1.2 to 4.2 and hurts the heuristic just as much.
- If the stated band is often wrong, neither policy is safe. The onboarding question matters more than the choice of policy.

## 7. Verdict

**Do not claim LinUCB is better than a heuristic given the same band.** The offline eval supports a narrower statement:

- LinUCB is clearly better in 7 of 17 worlds, level in 1, and worse in 9 (6 past the margin, 3 within it).
- Its value comes from the stated-band prior. Giving the heuristic the same prior removes most of the gap, except in the afternoon world.
- It is worse for evening and night students, and for students who open the app often.
- The deadline term and the gap term do not earn their place in this simulation.

**What would change this:** a live pick rate well above 50% in the classroom session, or fitted student parameters that
move the pick-model assumptions. The sensitivity run says the start result moves with the share of students who drag.

**Limits.**

- The students are simulated. Band, attention, drag share and the pick model are assumptions, not fitted to data.
- The start label is binary: it does not model how late a student starts.
- Lectures fill the calendar. Exams, assignments and placed tasks do not.
- The stated band has four values; true bands are single ranges; worlds are chosen, not a sample of a population.
- 12 tasks per student over 4 weeks is a short horizon for a learner.
- The hybrid model is not included.
- The numbers reproduce from `uv run python -m evalx run --seeds 30 --students 20` on commit `f9f5278a`. Protocol: [eval-protocol.md](./eval-protocol.md).
