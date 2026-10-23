/**
 * Wire contract between the NestJS backend and the stateless Python bandit
 * service (`services/bandit/`, reached at `BANDIT_SERVICE_URL`). The Python
 * service holds no per-user state — every `/v1/place` and `/v1/update` call carries
 * the relevant `(A, b)` in its payload and the backend persists what comes back
 * (`BanditArmState`). See `docs/adr/0001-linucb-model-design.md`.
 */

/** The 24 hour arms: one per local start hour (`HOUR_00` is 00:00 to 01:00). */
export const SCHEDULING_ARMS = [
  "HOUR_00",
  "HOUR_01",
  "HOUR_02",
  "HOUR_03",
  "HOUR_04",
  "HOUR_05",
  "HOUR_06",
  "HOUR_07",
  "HOUR_08",
  "HOUR_09",
  "HOUR_10",
  "HOUR_11",
  "HOUR_12",
  "HOUR_13",
  "HOUR_14",
  "HOUR_15",
  "HOUR_16",
  "HOUR_17",
  "HOUR_18",
  "HOUR_19",
  "HOUR_20",
  "HOUR_21",
  "HOUR_22",
  "HOUR_23",
] as const;

export type SchedulingArm = (typeof SCHEDULING_ARMS)[number];

/**
 * Context-vector width (`docs/adr/0001-linucb-model-design.md` §5.1). Fixes the
 * stored widths of `BanditArmState.A` (d·d), `BanditArmState.b` (d) and
 * `SlotProposal.featureVector` (d). Changing it is a migration.
 */
export const FEATURE_DIM = 7;

/**
 * A single arm's persisted LinUCB state. `A` is row-major `d·d`, `b` is length
 * `d`. Empty arrays mean "cold prior" — the Python service substitutes
 * `A = ridge·I`, `b = 0`.
 */
export interface BanditArmStateWire {
  A: number[];
  b: number[];
}

/** `POST /v1/update` request body. A reward for one hour arm, kernel-spread over all 24. */
export interface BanditUpdateRequest {
  ridge: number;
  /** The hour arm of the slot the reward is for. */
  arm: SchedulingArm;
  /** The context vector the proposal was scored with; length {@link FEATURE_DIM}. */
  x: number[];
  reward: number;
  /** All 24 hour arms of the current state. */
  arms: Record<SchedulingArm, BanditArmStateWire>;
}

/** `POST /v1/update` response: all 24 hour arms after folding in the reward. */
export interface BanditUpdateResponse {
  arms: Record<SchedulingArm, BanditArmStateWire>;
}
