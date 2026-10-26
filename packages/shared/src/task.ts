import type { PlacementReason } from "./placement";
import type { PlacementChip } from "./placement-chip";

/**
 * What kind of session this is.
 *
 * - `TASK` — flexible study work: has a `deadline`, placed on the calendar by
 *   the scheduling engine, freely draggable/resizable.
 * - `ASSIGNMENT` / `EXAM` / `LECTURE` — fixed events: the user (or an LMS/portal
 *   sync) pins a concrete `scheduledStartTime`; no `deadline`, not moved by the
 *   engine. May carry an `rrule` (a weekly lecture, a recurring lab).
 * - `DND` — a do-not-disturb block: fixed time, optional `rrule` recurrence,
 *   excluded from scheduling (the engine schedules *around* it).
 *
 * Every fixed type (`ASSIGNMENT` / `EXAM` / `LECTURE` / `DND`) may be recurring:
 * an `rrule` on its series expands into one virtual occurrence per date, and a
 * single occurrence can be deleted without touching the rest.
 */
export type SessionType = "TASK" | "ASSIGNMENT" | "EXAM" | "LECTURE" | "DND";

/** Where a session came from. */
export type SessionSource =
  | "USER"
  | "LMS"
  | "PORTAL"
  | "AUTO"
  /** Busy time imported from the user's Google or phone calendar: read only. */
  | "GOOGLE"
  | "DEVICE";

export interface Session {
  id: string;
  title: string;
  /** HTML. */
  note: string | null;
  /**
   * Free-text location (room / building / campus), or `null`. Set directly by
   * the client for a user-pinned session; written by the DLU watchers from the
   * upstream room for an ingested fixed session.
   */
  location: string | null;
  /** Always a positive multiple of 15. */
  durationMinutes: number;
  /**
   * ISO-8601 string. Present for `TASK`; `null` for the fixed types
   * (`ASSIGNMENT` / `EXAM` / `LECTURE` / `DND`).
   */
  deadline: string | null;
  type: SessionType;
  source: SessionSource;
  /** Real id of the lecture, exam or assignment this prep `TASK` is for, or `null`. */
  prepForSessionId: string | null;
  /** ISO-8601 start of the prepared lecture occurrence, or `null` when not a recurring lecture. */
  prepForOccurrenceStart: string | null;
  /** Free-form labels. */
  /**
   * ISO-8601 instant, or null when unscheduled. For fixed types it is set
   * directly by the client; for `TASK` the engine places it, and drag/resize
   * are plain field writes via `PATCH /sessions/:id`.
   */
  scheduledStartTime: string | null;
  /** Minutes before start; `null` uses the user's default, `0` means no alarm. */
  reminderMinutes: number | null;
  /**
   * Set when this session belongs to a recurring fixed series (`DND` /
   * `ASSIGNMENT` / `EXAM` / `LECTURE`). This `Session` is one *virtual
   * occurrence*: its `id` is `"<seriesId>::<startISO>"`, not a real row id,
   * and edits/deletes on it are routed by the backend.
   */
  seriesId: string | null;
  /** The recurrence rule of this session's series, if any (RFC 5545 RRULE, bare — no `DTSTART`). */
  rrule: string | null;
  /**
   * The portal's course-section id (`ScheduleStudyUnitID`) for a
   * portal-ingested `LECTURE` meeting — the grouping key behind the
   * `DELETE /sessions/timetable-group/:sessionId[/from]` routes
   * ({@link RemoveTimetableGroupResponse}). `null` for every other session,
   * including a user-created recurring `LECTURE` (those use `seriesId`
   * instead).
   */
  timetableGroupId: string | null;
  /**
   * The course this session belongs to, or `null`: `lms:<Moodle course id>`
   * for an LMS item, `portal:<ScheduleStudyUnitID>` for a portal meeting or
   * exam.
   */
  courseKey: string | null;
  /**
   * `true` when a scheduled `TASK` ends after its `deadline` (the user chose
   * "accept late deadline" — see {@link InfeasiblePolicy}). Clients render it
   * with the red "late" block style. Always `false` for the fixed types and
   * for unscheduled tasks.
   */
  late: boolean;
  /**
   * Why the scheduler picked the current start. `null` when unscheduled, when
   * the start was set by the user or a move since, or for a fallback placement.
   */
  placementReason: PlacementReason | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the user chose when a new/edited `TASK` cannot be placed before its
 * deadline even after the engine repacked flexible tasks
 * (`services/bandit/README.md` -> "Displacement"). Sent as
 * `infeasiblePolicy` on `POST /sessions` / `PATCH /sessions/:id`.
 *
 * - `ACCEPT_CONFLICTS` — meet the deadline: place the task in the best slot
 *   before it even if that overlaps other sessions (fixed blocks never move).
 * - `ACCEPT_LATE_DEADLINE` — keep everything clear of conflicts: place the
 *   task in the first free slot after the deadline (`late: true`).
 */
export type InfeasiblePolicy = "ACCEPT_CONFLICTS" | "ACCEPT_LATE_DEADLINE";

/** `code` of the 409 {@link ScheduleInfeasibleError} the engine answers with. */
export const SCHEDULE_INFEASIBLE_CODE = "SCHEDULE_INFEASIBLE";

/**
 * 409 body when a `TASK` create/edit has no conflict-free slot before its
 * deadline, even after displacing flexible tasks, and the request carried no
 * `infeasiblePolicy`. Nothing was persisted. Show a toast with the two
 * `options` and retry the same request with the chosen `infeasiblePolicy`.
 */
export interface ScheduleInfeasibleError {
  success: false;
  statusCode: 409;
  message: string;
  code: typeof SCHEDULE_INFEASIBLE_CODE;
  options: InfeasiblePolicy[];
}

/** One session a {@link PlacementPlan} moves. */
export interface PlacementPlanMove {
  id: string;
  /** ISO-8601 current start. */
  from: string;
  /** ISO-8601 planned start. */
  to: string;
  /** Scheduler cost of the move (higher is worse). */
  cost: number;
}

/**
 * A placement the scheduler found but did not apply because it moves a
 * `CHOSEN` session. `sessionId` is the session being placed, or `null` for a
 * create (the session is inserted on confirm). Valid until `expiresAt`.
 */
export interface PlacementPlan {
  id: string;
  sessionId: string | null;
  /** ISO-8601 planned start of `sessionId`. */
  start: string;
  moves: PlacementPlanMove[];
  /** ISO-8601 instant after which the plan must be made again. */
  expiresAt: string;
}

/** `code` of the 409 {@link PlacementNeedsConfirmationError} a create answers with. */
export const PLACEMENT_NEEDS_CONFIRMATION_CODE = "NEEDS_CONFIRMATION";

/**
 * 409 body of `POST /sessions` when the only plan moves a `CHOSEN` session.
 * Nothing was persisted. Show `data.plan.moves` and confirm with
 * `POST /sessions/placement/confirm { planId }`.
 */
export interface PlacementNeedsConfirmationError {
  success: false;
  statusCode: 409;
  message: string;
  code: typeof PLACEMENT_NEEDS_CONFIRMATION_CODE;
  data: { plan: PlacementPlan };
}

/** `POST /sessions/placement/confirm` body. */
export interface ConfirmPlacementRequest {
  planId: string;
}

/**
 * `POST /sessions/placement/confirm` result: the placed session (the created
 * one for a create) and the moves applied, all under `undoGroupId`.
 */
export interface ConfirmPlacementResponse {
  session: Session;
  displacedSessions: DisplacedSession[];
  undoGroupId: string;
}

/**
 * `POST /sessions/undo/:groupId` result. `restored` are the sessions put back
 * on their previous start; `removedSessionIds` were created by the group and
 * are removed; `skippedSessionIds` changed again since, so they are left as they are.
 */
export interface UndoPlacementResponse {
  undoGroupId: string;
  restored: DisplacedSession[];
  removedSessionIds: string[];
  skippedSessionIds: string[];
}

/** `code` of the 409 {@link PlacementStaleError} confirm answers with. */
export const PLACEMENT_STALE_CODE = "PLACEMENT_STALE";

/**
 * 409 body of `POST /sessions/placement/confirm` when the plan no longer
 * holds (a session it moves changed, a slot is taken, or it expired). Nothing
 * was applied; the plan is discarded.
 */
export interface PlacementStaleError {
  success: false;
  statusCode: 409;
  message: string;
  code: typeof PLACEMENT_STALE_CODE;
}

/** `code` of the 409 {@link SlotTakenError} `POST /sessions/:id/slot-pick` answers with. */
export const SLOT_TAKEN_CODE = "SLOT_TAKEN";

/**
 * 409 body when `POST /sessions/:id/slot-pick` with `chose: "alternative"`
 * targets an alternative that now overlaps another session. Nothing was moved
 * or recorded — the pick can still be answered later (e.g. `"primary"`).
 */
export interface SlotTakenError {
  success: false;
  statusCode: 409;
  message: string;
  code: typeof SLOT_TAKEN_CODE;
}

/** `code` of the 503 {@link SchedulerDegradedError} (ADR-0003 section 2.4). */
export const SCHEDULER_DEGRADED_CODE = "SCHEDULER_DEGRADED";

/**
 * 503 body when the placement service is unavailable (timeout / breaker open /
 * disabled) AND the basic fallback found no free slot before the deadline. The
 * degraded path never displaces tasks or accepts conflicts/late, so nothing was
 * persisted. Retryable: show a toast with a retry that re-sends the same request.
 */
export interface SchedulerDegradedError {
  success: false;
  statusCode: 503;
  message: string;
  code: typeof SCHEDULER_DEGRADED_CODE;
}

/** One flexible task the engine moved to make room (scheduler-initiated, `SYSTEM_MOVE`). */
export interface DisplacedSession {
  id: string;
  /** ISO-8601 previous start. */
  from: string;
  /** ISO-8601 new start. */
  to: string;
}

/** Create a flexible study task — engine-scheduled, deadline-driven. */
export interface CreateTaskInput {
  type: "TASK";
  title: string;
  note?: string | null;
  /** Free-text location (room / building), optional. */
  location?: string | null;
  /** Positive multiple of 15. */
  durationMinutes: number;
  /** ISO-8601 deadline — required for a `TASK`; shared by every session of a series. */
  deadline: string;
  /** The lecture, exam or assignment this task prepares for. A recurring lecture occurrence id pins that occurrence. */
  prepForSessionId?: string;
  /** Answer to a prior 409 {@link ScheduleInfeasibleError}; omit on the first attempt. */
  infeasiblePolicy?: InfeasiblePolicy;
}

/** Create a fixed-time event the engine does not move. */
export interface CreateFixedSessionInput {
  type: "ASSIGNMENT" | "EXAM" | "LECTURE";
  title: string;
  note?: string | null;
  /** Free-text location (room / building), optional. */
  location?: string | null;
  /** Positive multiple of 15 (the client derives it from start/end pickers). */
  durationMinutes: number;
  /** ISO-8601 instant — required; there is no deadline for a fixed session. */
  scheduledStartTime: string;
  /**
   * RFC 5545 RRULE — omit for a one-off. When set, `scheduledStartTime` is the
   * first occurrence and the series expands from there (a weekly lecture, a
   * recurring lab session).
   */
  rrule?: string | null;
}

/** Create a do-not-disturb block, optionally recurring. */
export interface CreateDndInput {
  type: "DND";
  title: string;
  note?: string | null;
  /** Free-text location (room / building), optional. */
  location?: string | null;
  durationMinutes: number;
  scheduledStartTime: string;
  /** RFC 5545 RRULE; omit for a one-off block. */
  rrule?: string | null;
}

export type CreateSessionInput =
  | CreateTaskInput
  | CreateFixedSessionInput
  | CreateDndInput;

/**
 * Which occurrences a series-member update applies to (mirrors the delete
 * scopes, minus "this occurrence only" — a drag/resize/reschedule of a single
 * recurring fixed occurrence has no per-occurrence detach primitive, so
 * `"following"` is its finest granularity). Only meaningful when the PATCHed
 * session belongs to a series; omit for a one-off session or to keep today's
 * default (a materialized TASK sitting patches only itself; a recurring
 * occurrence re-anchors the whole series' time-of-day — see
 * `UpdateSessionDto`).
 */
export type UpdateScope = "occurrence" | "following" | "series";

/**
 * Generic metadata / reschedule / resize update — one endpoint
 * (`PATCH /sessions/:id`) covers all of it. Each field is a plain diff applied
 * directly.
 */
export interface UpdateSessionInput {
  title?: string;
  /** A prep `TASK` only: the lecture occurrence it prepares for (ISO-8601). */
  prepForOccurrenceStart?: string;
  note?: string | null;
  /** Free-text location (room / building). `null` clears it; omit to leave unchanged. */
  location?: string | null;
  durationMinutes?: number;
  /** ISO-8601 deadline (TASK only). Omit to leave unchanged. */
  deadline?: string;
  scheduledStartTime?: string | null;
  /**
   * RFC 5545 RRULE — for a recurring fixed session (`DND` / `ASSIGNMENT` /
   * `EXAM` / `LECTURE`). Applies series-wide; clears the series' per-occurrence
   * deletions since the pattern changed. `null` drops the recurrence.
   */
  rrule?: string | null;
  /** Which series members a `scheduledStartTime`/`durationMinutes` change applies to. */
  scope?: UpdateScope;
  /**
   * With `scope: "following" | "series"`, leave any instance whose new
   * landing slot would overlap another session untouched instead of moving
   * it there. Ignored otherwise.
   */
  skipConflicting?: boolean;
  /** TASK deadline/duration edits only: answer to a prior 409 {@link ScheduleInfeasibleError}. */
  infeasiblePolicy?: InfeasiblePolicy;
}

export interface SessionsListResponse {
  sessions: Session[];
}

/**
 * Title-autocomplete suggestions: the user's existing sessions, newest first
 * and deduped by normalized title — a multi-sitting TASK series' N sittings,
 * or a title independently re-created more than once, all collapse to just
 * the most-recently-created match — optionally filtered by the text typed so
 * far. Each item is a full {@link Session} so selecting one can populate the
 * rest of the create form.
 */
export interface SessionSuggestionsResponse {
  suggestions: Session[];
}

/**
 * The heuristic-vs-LinUCB `SlotProposal` this placement recorded, present
 * for a `TASK` create / deadline-change.
 *
 * On most events only one algorithm ran (today's random 50/50) and
 * `alternativeSlot` is `null`. On the `PAIRWISE_SAMPLE_RATE` fraction of
 * events both `HeuristicPlacer` and `BanditPlacer` ran — `alternativeSlot` is
 * the *other* one's raw proposal (not applied), and `POST
 * /sessions/:id/slot-pick` can switch to it.
 */
export interface SlotProposalFields {
  /** `null` unless this event's `SlotProposal` write succeeded. */
  slotProposalId: string | null;
  /** ISO-8601 instant actually applied to the session. */
  primarySlot: string | null;
  /** The other algorithm's raw pick, only when it ran and differs — else `null`. */
  alternativeSlot: string | null;
  /** `true` iff `alternativeSlot` is set and its start differs from `primarySlot`. */
  divergent: boolean;
  /** Flexible tasks moved to make room for this placement (empty when none). */
  displacedSessions: DisplacedSession[];
  /**
   * `true` when the placement service was unavailable and the basic fallback
   * placed the task (show a quiet "placed with basic scheduling" note). Absent
   * when placement ran normally.
   */
  schedulingDegraded?: boolean;
  /**
   * Undo handle for the moves this request made (`POST /sessions/undo/:groupId`).
   * Set when the request moved the session itself or displaced others; `null`
   * or absent otherwise.
   */
  undoGroupId?: string | null;
}

/**
 * Creating a `TASK` places it into its single best empty slot between now and
 * its deadline (`services/bandit/README.md`) — no other session is moved.
 */
export interface CreateSessionResponse extends Session, SlotProposalFields {
}

/**
 * Editing a `TASK`'s deadline re-places just that task. No other session is
 * moved.
 */
export interface UpdateSessionResponse extends Session, SlotProposalFields {
  /**
   * Set when a deadline change needs the user's go-ahead: the session keeps
   * its current start and nothing else moved. Confirm with
   * `POST /sessions/placement/confirm`. Absent otherwise.
   */
  placementPlan?: PlacementPlan;
  /** Ids left untouched by a `skipConflicting` update because their new landing slot conflicted. */
  skippedSessionIds?: string[];
}
export interface SessionDetailResponse extends Session {
  /** Chips explaining the placement; empty for fixed sessions and unplaced TASKs. */
  placementChips: PlacementChip[];
  /** Live prep `TASK`s linked to this session (or, for a recurring occurrence id, to that occurrence). */
  prepSessions: Session[];
  /**
   * For a recurring occurrence id: the start of the next occurrence that has no
   * prep plan yet, else `null`.
   */
  nextPrepOccurrenceStart: string | null;
  /** For a prep plan: the lecture occurrence, exam or assignment it prepares for, else `null`. */
  prepTarget: Session | null;
}

/**
 * `POST /sessions/:id/slot-pick` — records which side of a shown pairwise
 * comparison the user picked (`SlotProposal.pairwiseShown` events only).
 * `"alternative"` applies that slot as a `MOVE`; `"primary"` (or the caller
 * never posting at all) just records "kept". Idempotent — a proposal that
 * already has `chosenByUser` set is a no-op.
 */
export interface SlotPickRequest {
  slotProposalId: string;
  chose: "primary" | "alternative";
}

export interface SlotPickResponse {
  /** The session as it stands after applying the pick (unchanged for `"primary"`). */
  session: Session;
  /** Echoes what was actually recorded — `null` if the proposal had no pick to record. */
  chosenByUser: "primary" | "alternative" | null;
  /** Undo handle for the move an `"alternative"` pick applied (absent otherwise). */
  undoGroupId?: string;
}

/**
 * Result of `DELETE /sessions/:id`. `id` echoes what was deleted: a real row
 * id, or — when the id was a recurring occurrence ref (`"<seriesId>::<startISO>"`)
 * — that same ref, now added to the series' exception list so it stops
 * expanding.
 */
export interface RemoveSessionResponse {
  id: string;
}

/**
 * Result of a series-scoped delete:
 * - `DELETE /sessions/series/:seriesId` — the whole series;
 * - `DELETE /sessions/series/:seriesId/truncate?from=<ISO>` — a recurring
 *   (rrule) series: pull its `UNTIL` back to just before `from` ("this and all
 *   following"). `removedSessionIds` is empty here (occurrences are virtual);
 *   `seriesGone` is true if the cut left nothing and the series row was
 *   removed.
 */
export interface RemoveSessionSeriesResponse {
  seriesId: string;
  removedSessionIds: string[];
  seriesGone: boolean;
}

/**
 * Result of a timetable-group-scoped delete — the three-way delete choice for
 * a portal-ingested `LECTURE` (no `SessionSeries`/`seriesId`; grouped instead
 * by `Session.scheduleStudyUnitId`, the portal's own course-section id):
 * - `DELETE /sessions/timetable-group/:sessionId` — every meeting in the
 *   section, regardless of time ("all occurrences");
 * - `DELETE /sessions/timetable-group/:sessionId/from` — that meeting and
 *   every later one in the section ("this and following").
 */
export interface RemoveTimetableGroupResponse {
  removedSessionIds: string[];
}

/**
 * Response for `GET /sessions/deadline-options`: the six deadline quick-action
 * chip values (see `services/bandit/README.md`), each an ISO-8601 instant
 * derived from `horizon.ts`'s `endOfPeriod` ceiling math relative to the
 * request's `anchor`.
 */
export interface DeadlineOptionsResponse {
  today: string;
  tomorrow: string;
  thisWeek: string;
  nextWeek: string;
  thisMonth: string;
  noRush: string;
}
