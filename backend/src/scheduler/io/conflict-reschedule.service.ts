import { HttpException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { wouldConflict } from "./conflict-check";
import { DisplacementService } from "./displacement.service";
import { TaskPlacementService } from "./task-placement.service";

export interface RescheduleConflictsResult {
  rescheduled: { id: string; from: Date; to: Date }[];
  /** Still conflicting: no conflict-free slot. */
  failedSessionIds: string[];
  /** Undo handle for every move this call made. Absent when nothing moved. */
  undoGroupId?: string;
}

interface ConflictRow {
  id: string;
  seriesId: string | null;
  durationMinutes: number;
  deadline: Date;
  scheduledStartTime: Date;
}

/**
 * "Reschedule them all" for a sync-conflict notification (issue #62 D): every
 * listed task that still overlaps something is re-placed through the normal
 * placement path, earliest deadline first; `TASK` series sittings are
 * re-placed as a series to keep the per-day cap and sibling gap. Moves are recorded as
 * `SYSTEM_MOVE` under one undo group. Idempotent; unmovable tasks go to
 * `failedSessionIds`.
 */
@Injectable()
export class ConflictRescheduleService {
  private readonly logger = new Logger(ConflictRescheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placement: TaskPlacementService,
    private readonly displacement: DisplacementService,
  ) {}

  async rescheduleAll(
    user: User,
    sessionIds: string[],
    now: Date = new Date(),
  ): Promise<RescheduleConflictsResult> {
    const rows = (await this.prisma.session.findMany({
      where: {
        id: { in: sessionIds },
        userId: user.id,
        type: "TASK",
        deadline: { not: null },
        scheduledStartTime: { not: null },
        deleted: false,
      },
      select: {
        id: true,
        seriesId: true,
        durationMinutes: true,
        deadline: true,
        scheduledStartTime: true,
      },
      orderBy: { deadline: "asc" },
    })) as ConflictRow[];

    const result: RescheduleConflictsResult = {
      rescheduled: [],
      failedSessionIds: [],
    };
    const groupId = randomUUID();
    const conflicting: ConflictRow[] = [];
    for (const row of rows) {
      const stillConflicts = await wouldConflict(this.prisma, {
        userId: user.id,
        timezone: user.timezone,
        start: row.scheduledStartTime,
        durationMinutes: row.durationMinutes,
        excludeSessionIds: [row.id],
      });
      if (!stillConflicts) continue;
      conflicting.push(row);
    }

    for (const row of conflicting) {
      await this.placeOne(user, row, now, result, groupId);
    }
    if (result.rescheduled.length) result.undoGroupId = groupId;
    // Ids that vanished or were completed are simply not conflicts anymore.
    return result;
  }

  private async placeOne(
    user: User,
    row: ConflictRow,
    now: Date,
    result: RescheduleConflictsResult,
    groupId: string,
  ): Promise<void> {
    const from = row.scheduledStartTime;
    let to: Date | null;
    try {
      const placed = await this.placement.placeOnDeadlineChange({
        user,
        task: {
          id: row.id,
          durationMinutes: row.durationMinutes,
          deadline: row.deadline,
          prevStartMs: from.getTime(),
        },
        now,
        // It already has a start; don't move it onto another conflict.
        allowLastResort: false,
        undoGroupId: groupId,
      });
      to = placed.scheduledStartTime;
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      to = null;
    }
    if (!to || to.getTime() === from.getTime()) {
      // No slot: placement wrote nothing, so the task stays where it was.
      result.failedSessionIds.push(row.id);
      return;
    }
    await this.displacement.applyMoves(
      user.id,
      [{ id: row.id, fromMs: from.getTime(), toMs: to.getTime() }],
      () => row.durationMinutes,
      groupId,
    );
    result.rescheduled.push({ id: row.id, from, to });
  }
}
