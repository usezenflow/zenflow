# Offline eval protocol

How the simulator, the methods and the statistics work, and how to run them. Results are in [the report](./offline-eval-report.md). Concepts are defined in [section 1](#1-concepts). All students are simulated, so every result shows behaviour under stated assumptions, not real-world lift.

## Reading guide

Each item carries a tag. The thesis uses the tags as follows.

| Tag | Meaning |
|---|---|
| **MAIN** | In the main text. Supports a claim. |
| **APPX** | Appendix. Needed for reproducibility or for a reviewer's question. |
| **DROP** | Not reported. Kept in the code for development only. |

## 1. Concepts

For readers from traditional ML. Each entry says what the term means here.

### Learning setup

- **Bandit.** A decision problem where you pick one action per round and observe the reward only for that action. Here the action is a start slot for a study block.
- **Contextual bandit.** A bandit where each round comes with features (the context) that describe the options. Here the context describes each candidate day.
- **Arm.** One action choice in the bandit. In the six-band model an arm is a band of the day (morning, midday, and so on). In the hour model an arm is one start hour (24 arms).
- **Reward.** The signal after a placement. Here a start is +1, a move is negative in proportion to how far the block moved, and an offer pick is a smaller positive or negative value.
- **Exploration and exploitation.** Exploitation picks the arm with the best estimate. Exploration picks arms that are uncertain, so the learner gains information. The bonus for uncertainty below is how the method explores.
- **Cold start.** Behaviour before any data. The prior decides it.

### LinUCB (linear upper confidence bound)

- **Linear model per arm.** Each arm predicts reward as a dot product $\hat\theta_a^\top x$ of its own weights and the context.
- **Ridge regression.** The weights come from regularised least squares: $\hat\theta_a=A_a^{-1}b_a$, where $A_a=\lambda I+\sum xx^\top$ is the design matrix and $b_a=\sum r\,x$ the response. $\lambda$ is the ridge term, 1 here. It keeps $A_a$ invertible and shrinks weights toward zero when data is thin.
- **Upper confidence bound.** The score adds an uncertainty bonus: $u_a(x)=\hat\theta_a^\top x+\alpha\sqrt{x^\top A_a^{-1}x}$. The square root term is large where the arm has seen little data in that direction. $\alpha$ sets how much to explore (0.15 in production).
- **Prior as pseudo-data.** Starting $A_a$ and $b_a$ at non-zero values is equivalent to having seen fake observations first. The matrix seeds the six bands this way, with $N_0=0.5$ pseudo-observations at a weekday and at a weekend context.

### Kernel smoothing and pooling

- **Kernel.** A weight that spreads one update over nearby arms. Here a Gaussian over hours, circular so 23:00 and 00:00 are neighbours. The weight at distance $\Delta h$ is $\exp(-\Delta h^2/2\,\mathrm{sd}^2)$, which is 1 at the centre.
- **Kernel width (sd).** How far the spread reaches, in hours. 0.75 hours means the next hour gets about 0.75 of the update weight. The width was chosen on tuning seeds.
- **Pooling.** Sharing one update across related groups. Weekdays are pooled (Monday to Friday together), and Saturday with Sunday, so a start on Tuesday also teaches Wednesday.
- **Parameter sharing.** The general idea: one set of numbers serves several cases, so each case sees more data. Kernels and pooling are both forms of it.

### Features

- **Feature.** One numeric input to the model. The day context has seven: days to deadline, block length, days from now, weekend, fixed load, flexible load, and a bias.
- **Bias (intercept).** A constant feature of 1. It gives each arm its own baseline.
- **Unit normalisation.** Dividing a vector by its length, so every context has length 1. It changes the scale of all features together.

### Statistics

- **Paired design.** Every method runs on the same students and the same random draws. Each student then gives one difference, so student-to-student variation cancels out.
- **Common random numbers.** The paired design above, applied to the simulator's random draws. It reduces noise in differences.
- **Effect size (points).** The mean difference in adherence, in percentage points.
- **Bootstrap interval.** Resample students (or seeds) with replacement 2,000 times, recompute the mean each time, and take the 2.5th and 97.5th percentiles. A 95% interval is about this range.
- **Sign-flip test.** A permutation test. Under the null hypothesis, each student's difference is symmetric around zero, so flipping its sign at random should not change the mean much. The $p$ value is the share of random flips with a mean as extreme as the observed one.
- **Holm correction.** Multiple comparisons inflate false positives: with 12 tests, one is expected to pass at 5% by chance. Holm adjusts the $p$ values across a table so that the family-wise error rate stays at 5%.
- **Verdict margin.** A method is "better" when its interval is above zero, and "level" when the interval contains zero. The 3 point margin is the old non-inferiority threshold, and is not used for the ship decision.
- **Held-out and tuning seeds.** Tuning seeds (100 and up) choose settings. Held-out seeds are used once to check the chosen setting. A seed used for a decision is spent, because the decision was shaped by it. This is the simulation analogue of train and test splits, and it guards against overfitting to one set of seeds.
- **Pre-registration.** Writing the decision rule before running the held-out check, so it cannot be bent to fit the result. See [the ship rule](#7-seeds-and-the-ship-rule).
- **A/A test.** Two identical arms should give a difference of zero. It checks the harness.
- **Regret.** The sum of the gap between the best possible action and the one taken. Here the gap is in start chance, against the Oracle.
- **Sensitivity and robustness analysis.** Changing one assumption at a time and checking whether the conclusion survives. Each change is a world.
- **Distribution shift and drift.** The student's routine changes over time. The peak hour moves in steps or walks.
- **Forgetting (discount).** Shrinking old evidence each update, so the learner follows drift. A factor of 0.9 keeps 90% of past evidence.
- **Label noise.** Errors in the training signal. Here a real start may go unseen, and a non-start may be logged as a start.
- **Delayed reward.** The reward arrives some tasks after the action. Here, up to 10 tasks later.
- **Exposure.** A non-start only means something if the student was shown the block.
- **Off-policy evaluation.** Estimating how a new policy would have done from logs of an old one. Not used here.

## 2. Methods

Names are explicit. Code names are in parentheses where they differ.

| Name | Meaning | Tag |
|---|---|---|
| **H** | Heuristic. Scores each free slot from a table of preferred hours, updated by starts and moves. Shipped before this change. | MAIN |
| **H+K** (`H+K`) | H with the hour kernel and weekday pooling in its table update. Live A/B arm. | MAIN |
| **L6** (`L` in archives from before 23 Oct 2026) | Six-band LinUCB. Retired; historical numbers only. | MAIN |
| **L24** (`L-hourly`) | 24 hour arms, no kernel. | MAIN |
| **L24K** (`L-hourly-K`) | L24 with the kernel, width 0.75 hours. | MAIN |
| **L24N** (`L-hourly-K+N`) | L24K with unit-normalised day features, implemented offline. The model under test. | MAIN |
| **L24N production** (`L`) | L24N in the shipped placer, with fallback routing (displacement, last resort, 409 handling). Live A/B arm. | MAIN |
| **Oracle** | Knows each student's start chance. Upper bound. | MAIN |
| **Rand** | Random day and hour in the window. | MAIN (one sentence) |

### The methods in plain terms

**H** keeps a table of 7 days by 24 hours. Each start raises the cell it happened in, and each move lowers the old cell and raises the new one. A block's score is the sum of its cells, minus a penalty near the deadline.

**L6** holds six arms (the bands). Each arm is a ridge regression. A slot's score is the sum of the arm scores, weighted by how much of the slot falls in each band, plus a gap term and a deadline term. Its prior comes from the H table.

**L24** holds 24 arms, one per start hour. A slot is scored by the arm of its start hour, plus the same gap, deadline and stability terms as L6.

**L24K** is L24 with the kernel. A start at hour $h$ updates every arm, weighted by the kernel, so neighbouring hours learn from it.

**L24N** is L24K with the day features divided by their length.

## 3. The simulator

One student lives through one 15-week semester. Every method sees the same semester and the same random draws.

- **Timetable.** A weekly lecture timetable. Weeks 7 and 8 keep morning lectures only. Weeks 14 and 15 have none.
- **Courses and tasks.** 4 to 6 courses, each with 10 to 15 assignments, plus 4 to 6 exams. Each assignment or exam gets one prep block, sized as the production app sizes it.
- **Student.** Peak hour (chronotype), willingness to start, extra willingness close to a deadline, and a chance to answer offers (30% never do).
- **Start chance.** The start probability is the willingness times how well the hour fits the student's curve, times a factor for recent lectures, times a factor for the weekend, times the deadline boost. A block starts when a fixed random draw falls under that probability.
- **Signals.** Two signals reach the learner: a start, and an offer answer. These match the production signals.
- **Two placement paths.** H, H+K and L24N production run through the production placer (`run_place` in `evalx/run.py`). L24, L24K and the L24N reference run offline in `evalx/hourly.py`, which has no series, displacement, last-resort or 409 rules.

Full equations are in [section 5](#5-formal-model).

## 4. Measures

| Measure | Definition | Tag |
|---|---|---|
| **Adherence** | Share of a student's tasks started. Unplaced tasks count as not started. Averaged over students. | MAIN |
| **Hours before deadline** | Block end to deadline, averaged over placed blocks. | MAIN |
| **Last-day share** | Share of placed blocks ending within 24 hours of the deadline, over tasks with a window of 3 days or more. | MAIN |
| **Conflict free** | Share of placed blocks clear of lectures and earlier blocks. | APPX |
| **Regret** | Sum of the Oracle's start chance minus the method's, per student. | APPX |
| **Worse share** | Share of students whose adherence is lower under the second method. | MAIN |
| **Events** | Starts and moves per student. | DROP |

## 5. Formal model

Notation: student $i$ has tasks $j=1\dots N_i$ in arrival order. A block starts at $s$ and ends at $e=s+D$ on the 15-minute grid. Feasible starts $F$ satisfy $a\le s$, $e\le T$, avoid quiet hours (23:00 to 06:00), and clear lectures and placed blocks.

**Student start probability.** Hour of day $h$, peak $\pi$ (shifted $+1.5$ hours on weekends), circular gap $g=\min(\lvert h-\pi\rvert,24-\lvert h-\pi\rvert)$.

$$\mathrm{fit}(s)=\max\!\big(0.05,\;e^{-g^2/(2\cdot2.5^2)}\big)\cdot q(h),\qquad q=0.1\ \text{if}\ h\ge23\ \text{or}\ h<6,\ \text{else}\ 1$$

$$\phi(s)=1-0.5\min\!\big(1,\tau/300\big),\qquad \tau=\text{lecture minutes in the 300 minutes before } s$$

$$p(s)=\min\!\Big(1,\;\alpha_i\,\mathrm{fit}(s)\,\phi(s)\cdot 0.7^{[\text{weekend}]}\cdot(1+\iota_i)^{[T-s\le 2\text{ days}]}\Big)$$

The student starts when $u<p(s)$, with $u\sim U(0,1)$ fixed per task and shared by every method.

| Trait | Draw |
|---|---|
| Chronotype peak $\pi$ | lark 9:00 (20%), day 14:00 (25%), evening 20:00 (40%), owl 21:30 (15%), plus $N(0,0.5)$ |
| Attention $\alpha_i$ | $U(0.15,0.7)$ |
| Deadline boost $\iota_i$ | $U(0,1)$ |
| Offer response | 0 with probability 0.3, else $U(0.4,0.7)$ |

**Semester generator.** Weakness $w\sim U(0,1)$. Block length $D=15\,\mathrm{round}\big(B(0.75+0.5w)/15\big)$ with $B=90$ (assignment) or $180$ (exam), at least 30 minutes. Window opens $L$ days before $T$, with $L=1+\mathrm{round}(2w)$ for assignments and $2+\mathrm{round}(4w)$ for exams. Courses $\sim U\{4..6\}$, each with $U\{10..15\}$ assignments due at 23:00 on a day $\sim U\{10..90\}$. Exams $U\{4..6\}$ on weekdays in weeks 7, 8, 14 and 15, at 08:00 or 13:00.

**H.** Score $S_H(s)=P(s)-\omega\max\!\big(0,1-\tfrac{T-e}{R_H}\big)$, where $P(s)=\tfrac14\sum_k M[c(s+15k)]$ sums the table over the block's 15-minute cells. $\omega=0.2$, $R_H=24$ hours. After a start at $s$, $M[c(s)]\leftarrow\mathrm{clip}(M[c(s)]+\eta\kappa,-1,1)$ with $\eta=0.2$, $\kappa=0.25$.

**L6.** Arms $a$ are bands 0 to 8, 8 to 11, 11 to 14, 14 to 17, 17 to 20, and 20 to 24. Context $x_d$ has seven entries: days to deadline, block length, days from now, weekend sign, fixed load, flexible load, bias. Each is scaled as in `src/core/context_vector.py`: days, length and weekday are signed to $[-1,1]$, the two loads are clipped to $[0,1]$ after dividing by 12 hours, and the bias is 1.

$$S_{L6}(s)=\sum_a\rho_a(s)\,u_a(x_d)+w_P\frac{P(s)}{D/60}+\delta(e)+w_G\,g(s)$$

$\rho_a$ is the share of the block in band $a$. $w_P=1$ is the matrix term, which is inactive in production. $\delta$ is the deadline penalty with weight 0.2 and reach 24 hours. $w_G=0.2$ is the gap term.

$$g(s)=\tfrac12\min\!\big(1,\tfrac{f_{\mathrm{before}}}{60}\big)+\tfrac12\min\!\big(1,\tfrac{f_{\mathrm{after}}}{60}\big)$$

$f_{\mathrm{before}}$ and $f_{\mathrm{after}}$ are the free minutes to the previous and next fixed event.

**L24.** Arm $h$ for each start hour. A start at hour $h$ updates arm $h$ only. A slot's score is $u_{h}(x_d)$ for its start hour, plus the gap, deadline and stability terms.

**L24K.** As L24, but a start at hour $h$ updates arm $h'$ by $w(h'-h)$, with the circular kernel of width $\mathrm{sd}=0.75$ hours.

**L24N.** L24K with $x_d$ replaced by $x_d/\lVert x_d\rVert$.

## 6. Statistics

- For methods $X$ and $Y$, the paired difference per student is $\Delta_i=A_i^X-A_i^Y$.
- Intervals: 95% percentile bootstrap of the mean difference, 2,000 resamples of students. A second interval resamples seed means.
- $p$ values: sign-flip test, $p=\big(\#\{|\bar\Delta^*|\ge|\bar\Delta|\}+1\big)/2001$.
- Holm adjusts across each table of contrasts.
- A method is "better" when its interval is above zero, and "level" when the interval contains zero.

## 7. Seeds and the ship rule

### Seeds

| Seeds | Use | Status |
|---|---|---|
| 0 to 99 | The original headline run | Spent. Used for every number in the original report. |
| 0 to 9 | Held-out check of L24 against L6 and against L24 without kernel | Spent. Overlaps the headline run. |
| 100 and up | Tuning | Free to use, except seeds listed below as spent. |
| 300 to 309 | Held-out check of unit norm (L24N against L24) | Spent. |
| 400 to 499 | L24N against L6, historical | Spent. |
| 500 to 509 | Production check | Spent. |
| 500 to 599 | Main comparison | Spent. |
| 600 to 699 | Floor and ceiling | Spent. |
| 700 to 799 | Ladder and robustness | Spent. Latest held-out check. Re-run 23 Oct 2026. |
| 800 and up | Next held-out check | Free. Not yet used. |

A seed used for a decision is spent. A change made after a held-out check needs a new held-out block.

### Ship rule

Pre-registered. Applied per candidate against its direct predecessor:

1. At least +1.0 points of adherence, with the 95% interval above zero.
2. The worse share does not rise.
3. Every robustness world's lower bound is above −1.0 points.
4. `place` p95 under 1 ms (`evalx.bench`).

A variant that misses rule 1 is dropped. It is not re-tuned on the same seeds.

## 8. Robustness worlds

Each world changes one assumption, or a named combination, from the headline. Each is run with L24N against H+K, on tuning seeds 100 to 109 and held-out seeds 700 to 799.

| World | Config | What it tests | Type |
|---|---|---|---|
| Headline | none | The baseline. | Baseline |
| Hour matters less | `timing` 0.5 and 0.25 | Whether the lead depends on the hour effect | Effect strength |
| Starts missed | `detect` 0.6 and 0.3 | Learning from incomplete starts | Signal |
| Non-starts logged | `false_start` 0.1 | Learning from false labels | Signal |
| Late rewards | `delay` 3 and 10 | Learning when rewards arrive late | Signal |
| Peak shifts once | `drift` step, 3 hours | One abrupt routine change | Routine |
| Peak walks | `drift` walk, 1 and 2 hours every two weeks | Gradual routine change | Routine |
| Forgetting | `discount` 0.9, with a 2 hour walk; 0.95, with the typical and harsh mixes | Whether discounting old evidence helps | Memory |
| Typical mix | `timing` 0.5, `detect` 0.6, `delay` 3, `tap_scale` 0.5, walk 1 | Several mild effects together | Combined |
| Harsh mix | `timing` 0.25, `detect` 0.3, `false_start` 0.1, `delay` 10, `tap_scale` 0.2, walk 1.5 | Several strong effects together | Combined |

## 9. Run

```bash
cd services/bandit
uv run python -m evalx run --seeds 10 --students 200 --seed-offset 100 --arms L,L-hourly-K   # tuning
uv run python -m evalx run --seeds 10 --students 200 --seed-offset 300 --arms L,L-hourly-K+N --config '{"kernel_sd": 0.75}'
uv run python -m evalx run --seeds 100 --students 100 --ablations                          # headline, 10,000 students
uv run python -m evalx.bench                                                               # ms per placement and update
```

The report's archives come from these runs, with `--out` pointing at a scratch directory:

```bash
uv run python -m evalx run --seeds 100 --students 100 --seed-offset 500 --arms H,H+K,L,L-hourly-K+N        # main comparison
uv run python -m evalx run --seeds 100 --students 100 --seed-offset 600 --arms H,H+K,L,L-hourly-K+N,Oracle,Rand
uv run python -m evalx run --seeds 100 --students 100 --seed-offset 700 --arms H,H+K,L,L-hourly,L-hourly-K,L-hourly-K+N,Oracle,Rand
uv run python -m evalx reality --seeds 100 --students 20 --seed-offset 700                                 # robustness
uv run python -m evalx run --seeds 10 --students 100 --seed-offset 500 --arms L,L-hourly-K+N,H+K          # parity check
uv run python -m evalx reality --seeds 10 --students 200 --seed-offset 100                                 # robustness, tuning
uv run python -m evalx.figures --out <run dir> --paper ../../docs/scheduler/figures                        # paper figures
```

The `L` arm means production in archives from 23 Oct 2026 and six-band L6 in the historical archive.

- `--seeds N --seed-offset K` runs seeds $K$ to $K+N-1$. `--students` is per seed.
- `--config` takes a JSON object of settings: `kernel_sd`, `kernel_pool`, `timing`, `detect`, `false_start`, `delay`, `drift`, `discount`, `shape`, `chrono`, `attention_scale`, `opens_shift`, `opens_uninformative`, `fatigue_scale`.
- Outputs go to `services/bandit/evalx/out/` (ignored by git). `--out <dir>` redirects them.
- Subcommands `sensitivity`, `deadline`, `heuristic`, `reality` and `misspec` run the older six-band sweeps. They are APPX.

## 10. Tests

`tests/test_evalx.py`, `tests/test_evalx_metrics.py`, `tests/test_evalx_hourly.py`, `tests/test_preference_kernel.py`:

- Placer parity with `/v1/place`, and reward parity with the backend.
- Seed determinism, A/A identity, Oracle above every method and Rand below.
- Zero kernel and zero pooling reproduce the plain update exactly.
- Hour arms: one-hot update at zero width, kernel neighbours, circular wrap, prior follows the matrix, normalised context has length 1.

## 11. Limits

- Simulated students. Start curves, willingness and offer response are assumed, not measured.
- One weekly timetable per student, with no rescheduled classes.
- L6's matrix term is inactive in production. Any claim about matrix smoothing applies to H only.
- Fallback routing (displacement, last resort, 409) is out of scope for the offline arms. Production has it, and the gap is 0.6 points on seeds 600 to 699.
- Kernel width was chosen on tuning seeds and is not re-tuned on held-out seeds.
- L24N has not been timed. The `place` p95 check in the ship rule is still to run.
