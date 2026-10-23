import { BadRequestException, Injectable } from "@nestjs/common";
import type { InfeasiblePolicy } from "@zenflow/shared";
import { Prisma, type User } from "../../../generated/prisma";
import { withSpan } from "../../observability/otel";
import { PrismaService } from "../../prisma/prisma.service";
import { PythonPlacer } from "./python-placer.service";
import { toPlacementPlanDto } from "./placement-plan";
import { PLACEMENT_PLAN_TTL_MS } from "../constants";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import { ceilToSlot, MS_PER_MINUTE } from "../core/slot";
import type { PlaceableTask, PlacementResult } from "../types/placement.types";

type Trigger = "create" | "deadline-change";

/** Options a single placement shares with its caller (ADR-0022). */
interface SinglePlacementOptions {
  /** Groups the moves this placement applies under one undo entry. */
  undoGroupId?: string;
  /** A create's `CreateSessionDto`, kept with a plan so a confirm can insert it. */
  createInput?: Prisma.InputJsonValue;
}

/**
 * The single placement entry point `sessions/` talks to. It owns the whole
 * "place a `TASK` and persist its `scheduledStartTime`" flow by delegating to
 * {@link PythonPlacer} (ADR-0003: Python owns ranking; Nest gathers, calls,
 * applies, persists). A Python failure falls back to the frozen TS heuristic
 * (`FallbackPlacer`, driven from inside `PythonPlacer`) — this service never
 * runs its own ranking.
 */
@Injectable()
export class TaskPlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly python: PythonPlacer,
  ) {}

  /**
   * Place a freshly-created single `TASK`. A plan that moves a `CHOSEN`
   * session comes back as `pendingPlan`; the caller stops the create there.
   */
  placeOnCreate(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
    infeasiblePolicy?: InfeasiblePolicy;
    createInput?: Prisma.InputJsonValue;
    undoGroupId?: string;
  }): Promise<PlacementResult> {
    return this.placeSingle(
      args.user,
      args.task,
      "create",
      args.now,
      args.infeasiblePolicy,
      true,
      { createInput: args.createInput, undoGroupId: args.undoGroupId },
    );
  }

  /**
   * Re-place a single `TASK` after its deadline changed. `allowLastResort:
   * false` returns a `null` start (nothing written) instead of the last
   * resort — only for callers whose task already has a start to keep.
   */
  placeOnDeadlineChange(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
    infeasiblePolicy?: InfeasiblePolicy;
    allowLastResort?: boolean;
    undoGroupId?: string;
  }): Promise<PlacementResult> {
    return this.placeSingle(
      args.user,
      args.task,
      "deadline-change",
      args.now,
      args.infeasiblePolicy,
      args.allowLastResort ?? true,
      { undoGroupId: args.undoGroupId },
    );
  }

  private async placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
    allowLastResort = true,
    options: SinglePlacementOptions = {},
  ): Promise<PlacementResult> {
    const res = await withSpan(
      "scheduler.placeSingle",
      () =>
        this.python.placeSingle(
          user,
          task,
          trigger,
          now,
          policy,
          allowLastResort,
          options.undoGroupId,
        ),
      { "scheduling.trigger": trigger, "session.id": task.id },
    );
    if (!res.needsConfirmation) return res;
    return this.keepPendingPlan(user, task, trigger, now, res, options);
  }

  /**
   * Stores a plan Python left for confirmation (ADR-0022). A create's plan
   * keeps the create input and no subject; a re-place keeps the subject's
   * current start so a confirm can detect that it changed.
   */
  private async keepPendingPlan(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    res: PlacementResult,
    options: SinglePlacementOptions,
  ): Promise<PlacementResult> {
    const pending = res.needsConfirmation;
    if (!pending) return res;
    const isCreate = trigger === "create";
    const row = await this.prisma.placementPlan.create({
      data: {
        userId: user.id,
        subjectId: isCreate ? null : task.id,
        subjectFrom:
          !isCreate && task.prevStartMs !== undefined
            ? new Date(task.prevStartMs)
            : null,
        startAt: new Date(pending.startMs),
        moves: pending.moves as unknown as Prisma.InputJsonValue,
        ...(options.createInput !== undefined
          ? { createInput: options.createInput }
          : {}),
        expiresAt: new Date(now.getTime() + PLACEMENT_PLAN_TTL_MS),
      },
    });
    return {
      ...res,
      needsConfirmation: undefined,
      pendingPlan: toPlacementPlanDto(row),
    };
  }

  /**
   * Read-only guard for a single `TASK` create / deadline edit, run BEFORE
   * anything is written: rejects a deadline too close for the duration (400),
   * and — when no slot exists — throws the 409 `ScheduleInfeasibleException`
   * (via `PythonPlacer`) unless the request already carries an
   * `infeasiblePolicy`. `taskId` (edit path) excludes the task itself.
   */
  async preflightTask(args: {
    user: User;
    taskId?: string;
    durationMinutes: number;
    deadline: Date;
    now: Date;
    policy?: InfeasiblePolicy;
  }): Promise<void> {
    const { user, durationMinutes, deadline, now } = args;
    if (
      ceilToSlot(now.getTime()) + durationMinutes * MS_PER_MINUTE >
      deadline.getTime()
    ) {
      throw new BadRequestException(
        "Won't fit before the deadline\nPick a later deadline.",
      );
    }
    await this.python.preflightSingle({
      user,
      taskId: args.taskId,
      durationMinutes,
      deadline,
      now,
      policy: args.policy,
    });
  }

  /**
   * Read-only pre-flight feasibility check for a single `TASK` create — `true`
   * iff at least one empty slot fits `durationMinutes` somewhere in
   * `now … deadline`. No DB write, no telemetry.
   */
  async canPlaceTask(args: {
    user: User;
    durationMinutes: number;
    deadline: Date;
    now: Date;
  }): Promise<boolean> {
    try {
      await this.python.preflightSingle(args);
      return true;
    } catch (err) {
      if (err instanceof ScheduleInfeasibleException) return false;
      throw err;
    }
  }
}
