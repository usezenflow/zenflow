/**
 * How far ahead the engine will scan for an open slot, and the ~2-month
 * effective deadline horizon.
 *
 * NOTE: `docs/adr/0001-linucb-model-design.md` §5.2/§10 quote `MAX_SCAN_DAYS = 90`.
 * The code ships 60; it is also the `minMaxSigned` divisor for the context
 * vector's `remaining_days_until_deadline` / `candidate_days_from_now` features,
 * so changing it shifts every long-horizon placement AND every stored feature
 * vector. Left at 60 deliberately — see the ADR addendum.
 */
export const MAX_SCAN_DAYS = 60;

/**
 * Per-update step size η for preference-matrix acquisition.
 *
 * Each accepted/rejected event moves the corresponding hour-bucket cell by
 * `η × delta` rather than a raw `±1`, so a single action nudges the weight
 * instead of spiking it. A slot needs roughly `1/η` consistent signals to
 * accumulate a full ±1 unit — at η=0.1, ten consecutive START events in
 * the same bucket converge to +1.0 (the same theoretical ceiling as before,
 * just reached gradually). The existing exponential time-decay in
 * `matrix-decay.ts` (half-life 21 days) erodes stale values on the nightly
 * cron independently of this constant.
 */
export const PREFERENCE_LEARNING_RATE = 0.2;

/** Weight of a kept placement on the preference matrix: a START, or a kept
 * pairwise option. A soft reward against the graded, up-to-full penalty of a move. */
export const PREFERENCE_KEPT_WEIGHT = 0.25;
/**
 * H+K, the heuristic arm: the hour kernel and weekday pooling of a START or MOVE
 * matrix update. Same values as the Python core (`services/bandit/src/core/`).
 */
export const HEURISTIC_KERNEL_SD = 0.75;
export const HEURISTIC_KERNEL_POOL = 1.0;

export const MIN = 60_000;

/**
 * Weight and saturation point for the slot-scoring "stability" nudge
 * (`core/slot-score.ts`'s `stabilityScore`, used by `bestFreeSlot` here and
 * mirrored by `services/bandit`'s LinUCB slot scoring): a light penalty for
 * moving a session away from the start time the user last set manually, so
 * it isn't churned without good reason.
 *
 * `STABILITY_WEIGHT` caps the term's maximum contribution to the total
 * score. It has to stay well under the scale of the terms it sits beside:
 * LinUCB's own arm-score term is a weighted blend of per-arm scores
 * whose inputs (context features, rewards) are all clamped to `[-1, 1]`
 * (`docs/adr/0001-linucb-model-design.md` §4/§5), plus a bounded UCB
 * exploration bonus (`BANDIT_ALPHA · √(xᵀA⁻¹x)`) — so it typically lands in
 * the low single digits. The preference-matrix term (`slotPreferenceScore`)
 * sums per-hour cells that are themselves clamped to `[-1, 1]`. At
 * `STABILITY_WEIGHT = 0.1`, the stability term can contribute at most ±0.1
 * — an order of magnitude below either, so it can only break near-ties
 * between otherwise-similar candidates, never outweigh real personalization.
 *
 * `STABILITY_SATURATION_HOURS` is the distance at which the penalty maxes
 * out: beyond this many hours from the previous manually-set start, moving
 * even further away costs no more. Without a cap, a rescheduling window
 * spanning the full `MAX_SCAN_DAYS` horizon would let raw hour-distance grow
 * into the hundreds and swamp every other term — the same saturating-distance
 * shape already used for the `MOVE` reward (`MOVE_REWARD_SCALE_MINUTES`).
 */
export const STABILITY_WEIGHT = 0.1;
export const STABILITY_SATURATION_HOURS = 4;

/**
 * Reward written on the `SessionEvent` (ADR-0042). A user drag/resize of a
 * scheduled TASK is graded by displacement (`MOVE`). A placement whose slot
 * passed unmoved is `KEPT`. `CREATE` events carry a neutral 0.
 */
export const SESSION_MOVE_REWARD = -1.0;
export const SESSION_KEPT_REWARD = 1.0;
/** A placement counts as kept once its slot began this long ago and it was never moved. */
export const KEPT_GRACE_MS = 15 * 60_000;
/** The sweep ignores placements older than this: they were swept already or predate the signal. */
export const KEPT_LOOKBACK_MS = 14 * 24 * 60 * 60_000;
/**
 * Reward for the LinUCB arm when the user picks LinUCB's option in a shown
 * pairwise comparison (`docs/scheduler/ab-testing.md` §3). Below completion:
 * a preference, not an outcome.
 */
export const PAIRWISE_WIN_REWARD = 0.5;
/**
 * Reward for the LinUCB arm when the user keeps the heuristic's option over a
 * shown LinUCB option. Matches the simulator's keep-default penalty
 * (`services/bandit/src/simulation/engine.py`). Without it, LinUCB is only
 * rewarded for being chosen.
 */
export const PAIRWISE_LOSS_REWARD = -0.2;
/**
 * Preference-matrix bonus at the kept slot when the user keeps the heuristic's
 * shown option: the same scale as a pairwise win on the matrix.
 */
export const PAIRWISE_KEEP_PREFERENCE_WEIGHT =
  PREFERENCE_KEPT_WEIGHT * PAIRWISE_WIN_REWARD;

/**
 * Reward for the LinUCB arm when the user deletes a placed TASK at least an hour
 * before it starts (`core/reward.ts` `deleteReward`). A delete says "not needed",
 * weaker than a move, so it equals a 60 minute move (60 / MOVE_REWARD_SCALE_MINUTES).
 * A prior, not a measurement: see docs/adr/0043-delete-signal.md for the shadow-mode rollout.
 */
export const DELETE_REWARD = -0.25;
/** Off until the offline evaluation passes. While off, the event stores the reward but the arm does not learn from it. */
export const DELETE_REWARD_ENABLED = false;
/**
 * Preference-matrix weight on the deleted slot. The matrix variant exists only in
 * the simulator (`services/bandit/evalx`), so production keeps it at 0.
 */
export const PREFERENCE_DELETE_WEIGHT = 0;

/**
 * Disjoint LinUCB scheduling parameters
 * (`docs/adr/0001-linucb-model-design.md` §10). `BANDIT_ALPHA` is the
 * exploration coefficient on `α·√(xᵀA⁻¹x)`; `BANDIT_RIDGE` is the ridge `λ`
 * (`A = λI` at cold start). Both are sent to the Python bandit service in every
 * `/v1/place` / `/v1/update` payload.
 */
export const BANDIT_ALPHA = 0.15;
export const BANDIT_RIDGE = 1.0;

/**
 * `D_SCALE` for the graded `MOVE` reward: the displacement (in minutes, from
 * the model's originally proposed start) at which the penalty saturates at −1.
 * `reward = dragDistanceMinutes === 0 ? 0 : -min(1, |drag| / MOVE_REWARD_SCALE_MINUTES)`.
 */
export const MOVE_REWARD_SCALE_MINUTES = 240;

/** Stamped on `SlotProposal.modelVersion` for LinUCB proposals. */
export const BANDIT_MODEL_VERSION = "linucb-hours24-v1";

/**
 * Layout of the hour arms. Mirrors `ARM_LAYOUT` in
 * `services/bandit/src/core/constants.py`, which prefixes the Python
 * `paramsVersion` stored as `SlotProposal.modelVersion`. Bump both when the arm
 * layout changes: delayed rewards from proposals made under another layout are
 * dropped.
 */
export const ARM_LAYOUT = "hours24-v1";

/** `true` when a proposal's `modelVersion` was stamped under the current arm layout. */
export function isCurrentModelVersion(
  version: string | null | undefined,
): boolean {
  return (
    version === BANDIT_MODEL_VERSION ||
    (version?.startsWith(`py-${ARM_LAYOUT}-`) ?? false)
  );
}

/** `SlotProposal.experimentId` for the heuristic-vs-LinUCB A/B experiment. */
export const BANDIT_EXPERIMENT_ID = "linucb-heuristic-v1";

/**
 * Fraction of `TASK` create / deadline-change events (a `TASK` series rolls once, for
 * the whole series — #58) that get both policies computed (`computeBoth` on the
 * `/v1/place` request) and `SlotProposal.pairwiseShown = true`
 * (`docs/scheduler/ab-testing.md`
 * §3). Every other event runs exactly one algorithm — the existing 50/50
 * `primaryPolicy` pick — same as before this existed. Independent draw from
 * `primaryPolicy`'s own 50/50 roll.
 *
 * Defaults to 1 (every event). `PAIRWISE_SAMPLE_RATE` in the environment overrides it (clamped to
 * 0..1) so the load test can measure each policy's stand-alone latency at 0; leave it unset in prod.
 */
const pairwiseFromEnv = Number(process.env.PAIRWISE_SAMPLE_RATE ?? "1");
export const PAIRWISE_SAMPLE_RATE = Number.isFinite(pairwiseFromEnv)
  ? Math.min(1, Math.max(0, pairwiseFromEnv))
  : 1;

/**
 * Smallest start-time gap (minutes) between the applied slot and the other
 * policy's pick for the pair to be offered as an A/B choice. Slots sit on a
 * 15-minute grid, so anything closer (9:00 vs 9:15) isn't a real decision for
 * the user. Closer pairs are still recorded in `SlotProposal`, with
 * `pairwiseShown = false`.
 */
export const MIN_ALTERNATIVE_GAP_MINUTES = 60;

/** Most flexible tasks one displacement may move (capped cascade, issue #62 B). */
export const MAX_DISPLACED_TASKS = 6;
/** New-task candidate slots simulated per displacement window (min-displacement search). */
export const DISPLACEMENT_CANDIDATES = 8;
/** Reward stamped on scheduler-initiated `SYSTEM_MOVE` events (never a user signal). */
export const SESSION_SYSTEM_MOVE_REWARD = 0;

/** Latest local start a scan considers (cap on days scanned, ~30d); does NOT
 * replace `MAX_SCAN_DAYS`, which still normalizes the context vector. */
export const SCAN_CAP_DAYS = 30;

/** How long a placement plan waiting for confirmation stays valid (ADR-0022). */
export const PLACEMENT_PLAN_TTL_MS = 30 * 60_000;

/**
 * Most automatic prep plans one student gets in 24 hours (level-up plan,
 * Phase 1). Plans past the cap are skipped, not held.
 */
export const PREP_DAILY_CAP = 5;
