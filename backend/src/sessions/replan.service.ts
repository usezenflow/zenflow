import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { IntervalMs } from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PrismaService } from "../prisma/prisma.service";
import { MS_PER_MINUTE } from "../scheduler/core/slot";
import { DisplacementService } from "../scheduler/io/displacement.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { constraintOf } from "./task-bounds";

/** One replan covers at most this many tasks, so a preview stays fast. */
const MAX_TASKS = 60;
const MAX_RANGE_DAYS = 30;

export type ReplanChange = "free" | "balanced";

export interface ReplanMove {
  id: string;
  title: string;
  from: string;
  to: string;
  deadline: string;
}

export interface ReplanPlan {
  moves: ReplanMove[];
  unchanged: number;
  /** No free slot before the deadline: left where it is. */
  unplaced: { id: string; title: string }[];
}

/**
 * Re-places every scheduled `TASK` in a date range from scratch: most urgent
 * first (least slack), each taking its best slot among what earlier ones left.
 * Nothing is pinned, user-moved tasks included. Fixed sessions and DND stay.
 * Writes are `SYSTEM_MOVE` events under one undo group, so the bandit learns
 * nothing from a replan and `undo_last_change` reverts it whole.
 * shortcut: scored one task at a time (~10 ms each); batch the context
 * vectors in the placer if ranges grow past MAX_TASKS.
 */
@Injectable()
export class ReplanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly placement: TaskPlacementService,
    private readonly displacement: DisplacementService,
  ) {}

  async plan(
    user: User,
    from: string,
    to: string,
    change: ReplanChange = "balanced",
    now: Date = new Date(),
  ): Promise<ReplanPlan> {
    const tz = user.timezone;
    const start = minutesToUtc(from, 0, tz);
    const end = minutesToUtc(to, 1439, tz);
    if (
      !(end > start) ||
      end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000
    ) {
      throw new BadRequestException(
        `Range must be 1 to ${MAX_RANGE_DAYS} days`,
      );
    }
    const rows = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        type: "TASK",
        deleted: false,
        seriesId: null,
        deadline: { not: null },
        scheduledStartTime: {
          gte: new Date(Math.max(start.getTime(), now.getTime())),
          lte: end,
        },
      },
    });
    if (rows.length > MAX_TASKS) {
      throw new BadRequestException(
        `Too many tasks to replan at once (${rows.length}). Pick a shorter range.`,
      );
    }

    const slack = (r: (typeof rows)[number]) =>
      (r.deadline as Date).getTime() -
      Math.max(now.getTime(), r.notBefore?.getTime() ?? 0) -
      r.durationMinutes * MS_PER_MINUTE;
    const ordered = [...rows].sort(
      (a, b) => slack(a) - slack(b) || b.durationMinutes - a.durationMinutes,
    );

    const ids = rows.map((r) => r.id);
    const claimed: IntervalMs[] = [];
    const plan: ReplanPlan = { moves: [], unchanged: 0, unplaced: [] };
    for (const r of ordered) {
      const proposed = await this.placement
        .proposeSingle({
          user,
          durationMinutes: r.durationMinutes,
          deadline: r.deadline as Date,
          now,
          constraint: { ...constraintOf(r), extraOccupied: [...claimed] },
          excludeSessionIds: ids,
          primaryPolicy: "LINUCB",
          ...(change === "balanced" && r.scheduledStartTime
            ? { prevStartMs: r.scheduledStartTime.getTime() }
            : {}),
        })
        .catch(() => null);
      if (!proposed) {
        plan.unplaced.push({ id: r.id, title: r.title });
        if (r.scheduledStartTime)
          claimed.push({
            startMs: r.scheduledStartTime.getTime(),
            endMs:
              r.scheduledStartTime.getTime() +
              r.durationMinutes * MS_PER_MINUTE,
          });
        continue;
      }
      claimed.push({
        startMs: proposed.getTime(),
        endMs: proposed.getTime() + r.durationMinutes * MS_PER_MINUTE,
      });
      if (proposed.getTime() === r.scheduledStartTime?.getTime()) {
        plan.unchanged++;
        continue;
      }
      plan.moves.push({
        id: r.id,
        title: r.title,
        from: (r.scheduledStartTime as Date).toISOString(),
        to: proposed.toISOString(),
        deadline: (r.deadline as Date).toISOString(),
      });
    }
    plan.moves.sort((a, b) => a.to.localeCompare(b.to));
    return plan;
  }

  /** Applies a freshly computed plan; returns the undo group. */
  async apply(
    user: User,
    from: string,
    to: string,
    change: ReplanChange = "balanced",
  ) {
    const plan = await this.plan(user, from, to, change);
    if (plan.moves.length === 0) return { ...plan, undoGroupId: null };
    const durations = new Map(
      (
        await this.prisma.session.findMany({
          where: { id: { in: plan.moves.map((m) => m.id) } },
          select: { id: true, durationMinutes: true },
        })
      ).map((r) => [r.id, r.durationMinutes]),
    );
    const undoGroupId = randomUUID();
    await this.displacement.applyMoves(
      user.id,
      plan.moves.map((m) => ({
        id: m.id,
        fromMs: Date.parse(m.from),
        toMs: Date.parse(m.to),
      })),
      (id) => durations.get(id) as number,
      undoGroupId,
    );
    return { ...plan, undoGroupId };
  }
}
