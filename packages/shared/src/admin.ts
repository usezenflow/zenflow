/**
 * Read-only aggregates for the management dashboard (`/admin/*`). Admin role only.
 * No response carries a user id or a student identifier.
 */

/** `SchedulingModel` in the Prisma schema. */
export type AdminPolicy = "HEURISTIC" | "LINUCB";

/** `ActiveUsersService`: distinct users per UTC day, the last 8 days kept. */
export interface ActiveDay {
  day: string;
  dau: number;
}

/**
 * Users grouped by the `User.createdAt` week. `weeks[n]` is the share of the
 * cohort with an APP_OPEN in week n after joining, `null` while that week is ahead.
 */
export interface RetentionCohort {
  cohortWeek: string;
  size: number;
  weeks: (number | null)[];
}

/** Users by the length of their current run of consecutive UTC days with an APP_OPEN. */
export interface StreakBucket {
  days: string;
  users: number;
}

/** `GET /admin/engagement` */
export interface EngagementResponse {
  dau: number;
  wau: number;
  activeDays: ActiveDay[];
  retention: RetentionCohort[];
  streaks: StreakBucket[];
}

/**
 * Per primary policy, PYTHON placements only. Counts come from `SlotProposal`
 * and the `SessionEvent` rows of each session's latest proposal.
 * `dragMinutes` is the mean of |dragDistanceMinutes| over MOVE rows.
 * `reward` is the mean `rewardScore` over KEPT and MOVE rows.
 * `due` counts placed sessions whose slot has passed. The kept rate is
 * `events.KEPT / due` (ADR-0042).
 */
export interface PolicyQuality {
  policy: AdminPolicy;
  proposals: number;
  acceptedUnmodified: number;
  due: number;
  events: { KEPT: number; MOVE: number };
  dragMinutes: number;
  reward: number;
}

/** `SlotProposal` counts per week (`date_trunc('week', timestamp)`) and policy. */
export interface WeeklyKept {
  week: string;
  policy: AdminPolicy;
  proposals: number;
  acceptedUnmodified: number;
}

/** `GET /admin/learning-quality` */
export interface LearningQualityResponse {
  policies: PolicyQuality[];
  weekly: WeeklyKept[];
}

/** `StudentProfile` columns a workload group is keyed on. */
export type WorkloadDimension = "faculty" | "className" | "cohort";

/**
 * `Session.durationMinutes` summed by weekday and hour of `scheduledStartTime`
 * in each student's timezone, for students sharing one `StudentProfile` value.
 * `minutes[weekday][hour]`, weekday 0 is Monday.
 */
export interface WorkloadGroup {
  dimension: WorkloadDimension;
  value: string;
  students: number;
  minutes: number[][];
}

/** Groups with fewer students than this are left out. */
export const WORKLOAD_MIN_GROUP = 5;

/** `GET /admin/workload` */
export interface WorkloadResponse {
  groups: WorkloadGroup[];
}
