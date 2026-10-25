"""Mirror of the scheduler constants in ``backend/src/scheduler/constants.ts``."""

TIME_GRANULARITY = 15
MS_PER_MINUTE = 60_000
SLOT_MS = TIME_GRANULARITY * MS_PER_MINUTE
HOUR_MS = 60 * MS_PER_MINUTE
DAY_MS = 24 * 60 * MS_PER_MINUTE

MAX_SCAN_DAYS = 60
PREFERENCE_LEARNING_RATE = 0.2
PREFERENCE_KEPT_WEIGHT = 0.25
STABILITY_WEIGHT = 0.1
STABILITY_SATURATION_HOURS = 4
MOVE_REWARD_SCALE_MINUTES = 240
# Reward of a placement whose slot passed unmoved (KEPT, ADR-0042).
KEPT_REWARD = 1.0
MATRIX_HALF_LIFE_DAYS = 21

PREFERENCE_SLOTS_PER_DAY = 24
PREFERENCE_MATRIX_LENGTH = 7 * PREFERENCE_SLOTS_PER_DAY
FEATURE_DIM = 7

DURATION_DIVISOR = 480
WORKLOAD_HOURS_DIVISOR = 12
# Day load is two grouped features: fixed blocks the user can't move, and
# flexible work the scheduler places (hours each, / WORKLOAD_HOURS_DIVISOR).
FIXED_LOAD_TYPES = ("LECTURE", "EXAM", "DND")
FLEX_LOAD_TYPES = ("TASK", "ASSIGNMENT")

# LinUCB slot score = linucb + proximity-scaled stability. The stability weight
# is full for a task whose old start is <= NEAR hours away and fades linearly to
# FAR at FAR_HOURS: upcoming tasks barely move, distant ones follow LinUCB.
STABILITY_WEIGHT_NEAR = 1.0
STABILITY_WEIGHT_FAR = 0.05
STABILITY_NEAR_HOURS = 24
STABILITY_FAR_HOURS = 168

# Layout of the time-of-day arms (their boundaries). Prefixes ``paramsVersion``,
# which Nest stores as ``SlotProposal.modelVersion``; Nest drops delayed rewards
# from proposals made under another layout. Mirrors ``ARM_LAYOUT`` in
# ``backend/src/scheduler/constants.ts``: bump both when the arm hours change.
ARM_LAYOUT = "hours24-v1"

# Weight of the (hour-averaged) preference matrix in the LinUCB slot score. It
# decides the hour *inside* the chosen band, where the arm term is flat, and so
# lets a user who keeps moving tasks to 10:00 pull the pick off the band centre.
# Sits between the stability weights and the LinUCB arm spread.
LINUCB_PREF_WEIGHT = 1.0
# Gap quality orders slots inside a band by breathing room around them (ADR-0038).
# The semester eval found +1.3 adherence points over no gap term on held-out seeds
# and no loss in 11 other student worlds, at a margin no worse than the heuristic's.
LINUCB_GAP_WEIGHT = 0.2

# Deadline pressure: a slot ending within DEADLINE_PENALTY_HORIZON_HOURS of the
# deadline loses up to DEADLINE_PENALTY_WEIGHT (linear). Slot-level only, so it
# touches neither the feature vector nor the learned arm state.
DEADLINE_PENALTY_WEIGHT = 0.2
DEADLINE_PENALTY_HORIZON_HOURS = 24
# LinUCB uses the same reach as the heuristic (ADR-0037); the offline eval found
# 48 hours cost adherence without moving blocks further from the deadline.
LINUCB_DEADLINE_HORIZON_HOURS = 24

# Displacement (issue #62 B).
MAX_DISPLACED_TASKS = 6

# Repack (cross-day re-solve when the cascade finds no layout). The move cap is
# larger than the cascade's; the time budget bounds the search.
REPACK_MAX_MOVES = 12
# The node budget keeps the search deterministic; the time budget is a backstop.
REPACK_MAX_NODES = 3_000
REPACK_TIME_BUDGET_S = 0.25
REPACK_CANDIDATES_PER_TASK = 8
# Off until the live A/B shows the repack beats the cascade on the crowded world.
REPACK_ENABLED = False

# Displacement cost. A flexible session starting within FROZEN_WINDOW_HOURS of
# now never moves. A move costs a base plus the hours moved, plus CROSS_DAY when
# its local day changes.
FROZEN_WINDOW_HOURS = 2
DISPLACE_COST_AUTO = 1
DISPLACE_COST_CROSS_DAY = 10

# Placement scan scope (ADR-0003; owned by Python, echoed via ``paramsVersion``).
SCAN_CAP_DAYS = 30
INFEASIBLE_HORIZON_DAYS = 30
