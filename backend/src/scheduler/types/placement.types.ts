import type {
  PlacementMove,
  PlacementPlan,
  IntervalMs,
  PlacementReason,
  SchedulingArm,
  SessionWindow,
} from "@zenflow/shared";
import type { Interval } from "../core/slot";

/**
 * Shared types for the placement layer (`io/*.service.ts`): the pure-core →
 * concrete-timestamp mapping (`docs/scheduler/reranking.md`) and the
 * `sessions/`-facing result shapes.
 */

/** The minimal task shape every placer needs. */
export interface PlaceableTask {
  id: string;
  durationMinutes: number;
  deadline: Date;
  prevStartMs?: number;
  constraint?: PlacementConstraint;
}

/** Where a `TASK` may not start: before `notBefore`, or outside `window`. */
export interface PlacementConstraint {
  notBefore?: Date | null;
  window?: SessionWindow | null;
  /** Time already claimed in memory (a replan in progress), on top of the calendar. */
  extraOccupied?: IntervalMs[];
}

/** An already-clamped local-day candidate range, inclusive on both ends. */
export interface PlacementWindow {
  /** Local 'YYYY-MM-DD' of the first candidate day. */
  firstDayStr: string;
  /** Local 'YYYY-MM-DD' of the last candidate day. */
  lastDayStr: string;
}

/** A concrete free slot with its preference/score value. */
export interface ScoredSlot {
  start: Date;
  score: number;
}

/** Which policy produced the applied placement. */
export type AppliedPolicy = "HEURISTIC" | "LINUCB" | "NONE";

/** The outcome of placing one single `TASK`. */
export interface PlacementResult {
  scheduledStartTime: Date | null;
  appliedPolicy: AppliedPolicy;
  /** `null` unless this event's `SlotProposal` write succeeded. */
  slotProposalId: string | null;
  /** The other algorithm's raw pick, only when the pairwise sample ran and it differs from what was applied. */
  alternativeSlot: Date | null;
  /** `true` iff `alternativeSlot` is set. */
  divergent: boolean;
  /** Flexible tasks moved to make room (scheduler-initiated); absent/empty when none. */
  displaced?: { id: string; from: Date; to: Date }[];
  /** `true` when the frozen TS fallback placed this (placement service unavailable, ADR-0003). */
  degraded?: boolean;
  /** Why `scheduledStartTime` was chosen (Python); `null`/absent for a fallback. */
  placementReason?: PlacementReason | null;
  /** `true` when no real slot existed and the "never unplaced" last resort was applied. */
  lastResort?: boolean;
  /** Undo handle for the moves this placement applied (`SYSTEM_MOVE` group). Absent when none moved. */
  undoGroupId?: string;
  /**
   * The plan Python wants but nothing was applied for: it moves a `CHOSEN`
   * session and the request allowed only confirmed moves (raw, from
   * `PythonPlacer`). `TaskPlacementService` stores it as `pendingPlan`.
   */
  needsConfirmation?: PendingPlacement;
  /** The stored plan the client confirms with `POST /sessions/placement/confirm` (ADR-0022). */
  pendingPlan?: PlacementPlan;
}

/** A plan Python returned as `NEEDS_CONFIRMATION` (raw, before it is stored). */
export interface PendingPlacement {
  startMs: number;
  moves: PlacementMove[];
}

/** The concrete placement LinUCB proposes for one `TASK`. */
export interface BanditPick {
  scheduledStartTime: Date;
  selectedArm: SchedulingArm;
  /** The length-`d` context vector for the chosen day. */
  featureVector: number[];
  /** Applied `wL` (LinUCB) / `wS` (proximity-scaled stability) weights. */
  weights: { wL: number; wS: number };
}

/** One scanned candidate day: its bounds, what occupies it, and its context vector. */
export interface CandidateDay {
  dayStr: string;
  dayStartMs: number;
  /** Local midnight of the NEXT day — exclusive per-day ceiling. */
  dayEndMs: number;
  occupied: Interval[];
  vector: number[];
}
