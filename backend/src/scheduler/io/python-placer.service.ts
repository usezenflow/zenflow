import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import type {
  InfeasiblePolicy,
  PlacedMember,
  PlacementMember,
  PlacementPolicy,
} from "@zenflow/shared";
import {
  PlacementSource,
  SchedulingModel,
  type User,
} from "../../../generated/prisma";
import {
  ExperimentService,
  type PolicyAssignment,
} from "../../experiments/experiment.service";
import type { ExperimentTrigger } from "../../experiments/experiment.types";
import {
  schedulerAppliedPolicy,
  schedulerPlacementDuration,
  schedulerPlacementSource,
} from "../../observability/metrics";
import { recordPhase } from "../../observability/phase-timings";
import { PrismaService } from "../../prisma/prisma.service";
import { MIN_ALTERNATIVE_GAP_MINUTES, SCAN_CAP_DAYS } from "../constants";
import { DAY_MS, lastResortStart, MS_PER_MINUTE } from "../core/slot";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import type { PlaceableTask, PlacementResult } from "../types/placement.types";
import { DisplacementService, type AppliedMove } from "./displacement.service";
import { FallbackPlacer } from "./fallback-placer.service";
import { PlacementGateway } from "./placement-gateway.service";
import { placementData } from "./placement-write";
import type { DegradedReason } from "./placement-mode";

/** Placeholder id for a pre-flight scan: no `Session` row exists yet. */
const PREFLIGHT_TASK_ID = "__preflight__";

type Trigger = ExperimentTrigger;

const placed = (o: PlacedMember["outcome"]): boolean =>
  o === "PLACED" ||
  o === "DISPLACED" ||
  o === "ACCEPTED_CONFLICTS" ||
  o === "ACCEPTED_LATE" ||
  o === "ACCEPTED_LAST_RESORT";

/**
 * `python` placement mode (ADR-0003 phase 4): gather -> `POST /v1/place` ->
 * apply -> persist. The A/B policy roll (`ExperimentService.assignPolicy`, the
 * only RNG) and every write stay here; all ranking is Python's. When the
 * service is unavailable the request is answered by the frozen heuristic
 * ({@link FallbackPlacer}): no displacement, then the best free slot up to
 * 30 days late (never 503).
 *
 * A placement runs after its `Session` row exists, so it never leaves a `TASK`
 * unplaced: when nothing real fits, the task gets the last resort (Python's
 * `ACCEPTED_LAST_RESORT`, or {@link lastResortStart} when Python is
 * unavailable or answered without a start) and the result carries
 * `lastResort: true`. Only the read-only pre-flights report a miss.
 */
@Injectable()
export class PythonPlacer {
  private readonly logger = new Logger(PythonPlacer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PlacementGateway,
    private readonly fallback: FallbackPlacer,
    private readonly experiment: ExperimentService,
    private readonly displacement: DisplacementService,
    @Optional() private readonly cls?: ClsService,
  ) {}

  // ---- pre-flights (read-only, run BEFORE anything is written) ----------

  /** Single `TASK` pre-flight: 409 when infeasible w/o policy (Python or fallback). */
  async preflightSingle(args: {
    user: User;
    taskId?: string;
    durationMinutes: number;
    deadline: Date;
    now: Date;
    policy?: InfeasiblePolicy;
  }): Promise<void> {
    const { user, deadline, now, policy } = args;
    const task: PlaceableTask = {
      id: args.taskId ?? PREFLIGHT_TASK_ID,
      durationMinutes: args.durationMinutes,
      deadline,
    };
    const req = await this.gateway.buildRequest({
      user,
      member: this.memberOf(task, "HEURISTIC", false),
      deadline,
      now,
      mode: "PREFLIGHT",
      maxScanDays: SCAN_CAP_DAYS,
      excludeSessionIds: args.taskId ? [args.taskId] : [],
    });
    const res = await this.gateway.placeSingleTwoPhase(req, user, task, policy);
    if (!res.ok) {
      this.noteFallback(res.reason);
      const start = await this.fallback.placeSingle(
        user.id,
        task,
        user.timezone,
        user.preferenceMatrix,
        now,
      );
      if (start || policy) return;
      throw new ScheduleInfeasibleException();
    }
    this.noteSource("python");
    const outcome = res.response.result.outcome;
    // A plan that needs confirmation is a feasible placement: the real
    // placement returns it as `needsConfirmation` (nothing is written here).
    if (placed(outcome) || policy || outcome === "NEEDS_CONFIRMATION") return;
    throw new ScheduleInfeasibleException();
  }

  /**
   * The start a single `TASK` would get, without writing anything (the
   * dry-run path). `startMs` is null when no slot fits. `needsConfirmation`
   * is set when the plan would move a `CHOSEN` session.
   */
  async proposeSingle(args: {
    user: User;
    durationMinutes: number;
    deadline: Date;
    now: Date;
    policy?: InfeasiblePolicy;
  }): Promise<{ startMs: number | null; needsConfirmation: boolean }> {
    const { user, deadline, now, policy } = args;
    const task: PlaceableTask = {
      id: PREFLIGHT_TASK_ID,
      durationMinutes: args.durationMinutes,
      deadline,
    };
    const req = await this.gateway.buildRequest({
      user,
      member: this.memberOf(task, "HEURISTIC", false),
      deadline,
      now,
      mode: "PREFLIGHT",
      maxScanDays: SCAN_CAP_DAYS,
      excludeSessionIds: [],
    });
    const res = await this.gateway.placeSingleTwoPhase(req, user, task, policy);
    if (!res.ok) {
      this.noteFallback(res.reason);
      const start = await this.fallback.placeSingle(
        user.id,
        task,
        user.timezone,
        user.preferenceMatrix,
        now,
      );
      return {
        startMs: start ? start.getTime() : null,
        needsConfirmation: false,
      };
    }
    this.noteSource("python");
    const r = res.response.result;
    if (r.outcome === "NEEDS_CONFIRMATION") {
      return { startMs: r.startMs, needsConfirmation: true };
    }
    return {
      startMs: placed(r.outcome) ? r.startMs : null,
      needsConfirmation: false,
    };
  }

  // ---- single TASK -------------------------------------------------------

  /**
   * `allowLastResort: false` (conflict "reschedule them all") answers a miss
   * with a `null` start and writes nothing, so a task that already has a
   * start keeps it instead of being moved onto another conflict.
   */
  async placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
    allowLastResort = true,
    undoGroupId?: string,
  ): Promise<PlacementResult> {
    const assignment = this.experiment.assignPolicy();
    const tStart = Date.now();
    const member = this.memberOf(
      task,
      assignment.primaryPolicy,
      assignment.pairwiseShown ||
        assignment.primaryPolicy === SchedulingModel.LINUCB,
    );
    const req = await this.gateway.buildRequest({
      user,
      member,
      deadline: task.deadline,
      now,
      mode: "PLACE",
      maxScanDays: SCAN_CAP_DAYS,
      excludeSessionIds: [task.id],
    });
    const res = await this.gateway.placeSingleTwoPhase(req, user, task, policy);
    if (!res.ok) {
      const degraded = await this.placeSingleDegraded(
        user,
        task,
        trigger,
        now,
        assignment,
        res.reason,
        policy,
        allowLastResort,
      );
      schedulerAppliedPolicy.add(1, {
        assigned: assignment.primaryPolicy,
        applied: degraded.appliedPolicy,
        trigger,
      });
      schedulerPlacementDuration.record((Date.now() - tStart) / 1000, {
        assigned: assignment.primaryPolicy,
        applied: degraded.appliedPolicy,
        source: "fallback",
      });
      return degraded;
    }
    this.noteSource("python");

    const r = res.response.result;
    if (r.outcome === "NEEDS_CONFIRMATION" && r.startMs !== null) {
      // Nothing is applied: the plan moves a CHOSEN session and must be
      // confirmed first (ADR-0022). Only the caller stores it.
      this.logger.log(
        `schedule[${trigger}] source=python session=${task.id} outcome=NEEDS_CONFIRMATION moves=${r.moves.length} paramsVersion=${res.response.paramsVersion}`,
      );
      return {
        scheduledStartTime: null,
        appliedPolicy: "NONE",
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
        needsConfirmation: { startMs: r.startMs, moves: r.moves },
      };
    }

    let lastResort = r.outcome === "ACCEPTED_LAST_RESORT";
    let start =
      placed(r.outcome) &&
      r.startMs !== null &&
      (allowLastResort || !lastResort)
        ? r.startMs
        : null;
    if (start === null && allowLastResort) {
      // Python should have answered ACCEPTED_LAST_RESORT; never leave the row
      // unplaced regardless.
      start = lastResortStart(
        task.durationMinutes,
        now.getTime(),
        task.deadline.getTime(),
      );
      lastResort = true;
      this.logger.error(
        `schedule[${trigger}] session=${task.id} python outcome=${r.outcome} had no start; pinned to last resort`,
      );
    }
    lastResort = lastResort && start !== null;
    const tApply = Date.now();
    const groupId = r.moves.length ? (undoGroupId ?? randomUUID()) : undefined;
    const displaced: AppliedMove[] = r.moves.length
      ? await this.applyMoves(user.id, r.moves, groupId)
      : [];
    // Python's reason describes Python's start only; a last resort it did not
    // pick has none.
    const placementReason =
      start !== null && start === r.startMs ? (r.reason ?? null) : null;
    if (start !== null) {
      await this.prisma.session.update({
        where: { id: task.id },
        data: placementData({
          scheduledStartTime: new Date(start),
          placementReason,
        }),
      });
    }

    const heuristicMs = r.heuristic?.startMs ?? null;
    const linucb = r.linucb;
    const rawAlternative =
      assignment.primaryPolicy === SchedulingModel.LINUCB
        ? heuristicMs
        : (linucb?.startMs ?? null);
    // Only a pair far enough apart is a real choice; closer ones stay
    // recorded but unshown (`pairwiseShown = false`) so analysis ignores them.
    const divergent =
      assignment.pairwiseShown &&
      linucb !== null &&
      rawAlternative !== null &&
      start !== null &&
      Math.abs(rawAlternative - start) >=
        MIN_ALTERNATIVE_GAP_MINUTES * MS_PER_MINUTE;

    const slotProposalId = await this.experiment.recordProposal({
      userId: user.id,
      sessionId: task.id,
      trigger,
      primaryPolicy: assignment.primaryPolicy,
      randomizationSeed: assignment.randomizationSeed,
      heuristicProposal: {
        scheduledStartTime:
          heuristicMs !== null ? new Date(heuristicMs).toISOString() : null,
      },
      proposedStartTime: start !== null ? new Date(start) : null,
      modelProposal: linucb
        ? {
            scheduledStartTime: new Date(linucb.startMs),
            selectedArm: linucb.selectedArm,
          }
        : null,
      featureVector: linucb?.featureVector ?? [],
      selectedArm: linucb?.selectedArm ?? null,
      weights: linucb?.weights ?? null,
      pairwiseShown: divergent,
      pairwisePositions: divergent
        ? { primaryPosition: Math.random() < 0.5 ? "first" : "second" }
        : null,
      placementSource: PlacementSource.PYTHON,
      degradedReason: null,
      modelVersion: res.response.paramsVersion,
    });
    recordPhase(this.cls, "db_apply", Date.now() - tApply);

    const appliedPolicy = start !== null ? r.appliedPolicy : "NONE";
    schedulerAppliedPolicy.add(1, {
      assigned: assignment.primaryPolicy,
      applied: appliedPolicy,
      trigger,
    });
    this.logger.log(
      `schedule[${trigger}] source=python session=${task.id} outcome=${r.outcome} ` +
        `assigned=${assignment.primaryPolicy} applied=${appliedPolicy} start=${
          start !== null ? new Date(start).toISOString() : "none"
        } moves=${r.moves.length} paramsVersion=${res.response.paramsVersion}`,
    );

    schedulerPlacementDuration.record((Date.now() - tStart) / 1000, {
      assigned: assignment.primaryPolicy,
      applied: appliedPolicy,
      source: "python",
    });
    return {
      scheduledStartTime: start !== null ? new Date(start) : null,
      placementReason,
      appliedPolicy: appliedPolicy === "NONE" ? "NONE" : appliedPolicy,
      slotProposalId,
      alternativeSlot:
        divergent && rawAlternative !== null ? new Date(rawAlternative) : null,
      divergent,
      displaced: displaced.length ? displaced : undefined,
      ...(groupId ? { undoGroupId: groupId } : {}),
      ...(lastResort ? { lastResort: true } : {}),
    };
  }

  /** Frozen-heuristic single placement (ADR-0003 2.4). */
  private async placeSingleDegraded(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    assignment: PolicyAssignment,
    reason: DegradedReason,
    policy: InfeasiblePolicy | undefined,
    allowLastResort: boolean,
  ): Promise<PlacementResult> {
    this.noteFallback(reason);
    let start = await this.fallback.placeSingle(
      user.id,
      task,
      user.timezone,
      user.preferenceMatrix,
      now,
    );
    // Infeasible accepted (or the row must not stay unplaced): best free slot
    // up to 30 days late.
    if (!start && (policy || allowLastResort)) {
      start = await this.fallback.placeSingle(
        user.id,
        { ...task, deadline: new Date(task.deadline.getTime() + 30 * DAY_MS) },
        user.timezone,
        user.preferenceMatrix,
        now,
      );
    }
    // Last resort: pinned by the deadline, overlap accepted (no TS ranking).
    let lastResort = false;
    if (!start && allowLastResort) {
      start = new Date(
        lastResortStart(
          task.durationMinutes,
          now.getTime(),
          task.deadline.getTime(),
        ),
      );
      lastResort = true;
    }
    if (!start) {
      // Only when the caller opted out of the last resort: nothing written.
      this.logger.warn(
        `schedule[${trigger}] source=ts_fallback reason=${reason} session=${task.id} start=none`,
      );
      return {
        scheduledStartTime: null,
        appliedPolicy: "NONE",
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
        degraded: true,
      };
    }
    await this.prisma.session.update({
      where: { id: task.id },
      data: { scheduledStartTime: start },
    });
    const slotProposalId = await this.recordFallbackProposal(
      user.id,
      task.id,
      trigger,
      assignment,
      start,
      reason,
    );
    this.logger.warn(
      `schedule[${trigger}] source=ts_fallback reason=${reason} session=${task.id} start=${start.toISOString()}${
        lastResort ? " lastResort" : ""
      }`,
    );
    return {
      scheduledStartTime: start,
      appliedPolicy: "HEURISTIC",
      slotProposalId,
      alternativeSlot: null,
      divergent: false,
      degraded: true,
      ...(lastResort ? { lastResort: true } : {}),
    };
  }

  // ---- helpers -----------------------------------------------------------

  /**
   * Give every still-unplaced series row the last resort, back-to-back so
   * pinned sittings never stack on each other or on placed siblings.
   */
  /**
   * `computeBoth` is true whenever LinUCB is primary or the event was
   * pairwise-sampled, so the heuristic pick is always recorded as
   * `SlotProposal.heuristicProposal`.
   */
  private memberOf(
    task: { id: string; durationMinutes: number; prevStartMs?: number },
    primaryPolicy: PlacementPolicy,
    computeBoth: boolean,
  ): PlacementMember {
    return {
      id: task.id,
      durationMinutes: task.durationMinutes,
      ...(task.prevStartMs !== undefined
        ? { prevStartMs: task.prevStartMs }
        : {}),
      primaryPolicy,
      computeBoth,
    };
  }

  private async applyMoves(
    userId: string,
    moves: { id: string; fromMs: number; toMs: number }[],
    groupId?: string,
  ): Promise<AppliedMove[]> {
    const rows = await this.prisma.session.findMany({
      where: { id: { in: moves.map((m) => m.id) }, deleted: false },
      select: { id: true, durationMinutes: true },
    });
    const dur = new Map(rows.map((r) => [r.id, r.durationMinutes]));
    return this.displacement.applyMoves(
      userId,
      moves,
      (id) => dur.get(id) ?? 15,
      groupId,
    );
  }

  private recordFallbackProposal(
    userId: string,
    sessionId: string,
    trigger: Trigger,
    assignment: PolicyAssignment,
    start: Date,
    reason: DegradedReason,
  ): Promise<string | null> {
    return this.experiment.recordProposal({
      userId,
      sessionId,
      trigger,
      primaryPolicy: assignment.primaryPolicy,
      randomizationSeed: assignment.randomizationSeed,
      heuristicProposal: { scheduledStartTime: start.toISOString() },
      proposedStartTime: start,
      modelProposal: null,
      featureVector: [],
      selectedArm: null,
      weights: null,
      pairwiseShown: false,
      pairwisePositions: null,
      placementSource: PlacementSource.TS_FALLBACK,
      degradedReason: reason,
      modelVersion: null,
    });
  }

  private noteSource(source: "python"): void {
    schedulerPlacementSource.add(1, { source, reason: "none" });
  }

  private noteFallback(reason: DegradedReason): void {
    schedulerPlacementSource.add(1, { source: "ts_fallback", reason });
  }
}
