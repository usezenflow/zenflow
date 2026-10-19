import { Injectable } from "@nestjs/common";
import type { PrepKind } from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { placeOrDiscard } from "../../sessions/placement-compensation";
import { PrismaService } from "../../prisma/prisma.service";
import { PREP_DAILY_CAP } from "../constants";
import { DAY_MS } from "../core/slot";
import { PrepSizingClient } from "./prep-sizing-client.service";
import { TaskPlacementService } from "./task-placement.service";

export interface PrepParent {
  id: string;
  title: string;
  kind: PrepKind;
  deadline: Date;
}

export type PrepPlanOutcome =
  | { status: "PLACED"; sessionId: string; startsAt: Date }
  /** A plan for this parent exists, or was deleted by the student. */
  | { status: "SKIPPED_EXISTS" }
  | { status: "SKIPPED_CAP" }
  | { status: "SKIPPED_INFEASIBLE" }
  /** No free slot inside the window; nothing is written. */
  | { status: "SKIPPED_NO_SLOT" };

/** The plan's title in the student's language, since it is stored as written. */
export function prepTitle(lang: User["lang"], title: string): string {
  return lang === "VI_VN" ? `Hoàn thành ${title}` : `Prep for ${title}`;
}

/** Thrown inside placement so {@link placeOrDiscard} removes the row. */
class NoPrepSlotError extends Error {}

/**
 * Creates the automatic prep plan for one exam or assignment (level-up plan,
 * Phase 1). Sizing and the window come from Python (`/v1/prep/size`); the plan
 * is placed by the normal TASK placement with the window opening as its
 * `now`, and never moves a student's chosen session.
 */
@Injectable()
export class PrepPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sizing: PrepSizingClient,
    private readonly placement: TaskPlacementService,
  ) {}

  async planFor(
    user: User,
    parent: PrepParent,
    now: Date,
  ): Promise<PrepPlanOutcome> {
    // Any row for this parent, deleted or not, means the plan was made already.
    const existing = await this.prisma.session.findFirst({
      where: { userId: user.id, prepForSessionId: parent.id },
      select: { id: true },
    });
    if (existing) return { status: "SKIPPED_EXISTS" };

    const made = await this.prisma.session.count({
      where: {
        userId: user.id,
        source: "AUTO",
        prepForSessionId: { not: null },
        createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      },
    });
    if (made >= PREP_DAILY_CAP) return { status: "SKIPPED_CAP" };

    const [marks, profile] = await Promise.all([
      this.prisma.studentMark.findMany({
        where: { userId: user.id },
        select: { letter: true, credits: true },
      }),
      this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { gpa4: true },
      }),
    ]);
    const sized = await this.sizing.size({
      kind: parent.kind,
      nowMs: now.getTime(),
      deadlineMs: parent.deadline.getTime(),
      marks,
      avgGpa4: profile?.gpa4 ?? null,
    });
    if (!sized.feasible) return { status: "SKIPPED_INFEASIBLE" };

    const row = await this.prisma.session.create({
      data: {
        type: "TASK",
        source: "AUTO",
        title: prepTitle(user.lang, parent.title),
        durationMinutes: sized.durationMinutes,
        deadline: parent.deadline,
        prepForSessionId: parent.id,
        userId: user.id,
      },
      select: { id: true, durationMinutes: true },
    });

    try {
      const placed = await placeOrDiscard(
        this.prisma,
        { userId: user.id, sessionIds: [row.id] },
        async () => {
          const res = await this.placement.placeOnDeadlineChange({
            user,
            task: {
              id: row.id,
              durationMinutes: row.durationMinutes,
              deadline: parent.deadline,
            },
            now: new Date(sized.windowStartMs),
            allowLastResort: false,
          });
          if (res.pendingPlan || !res.scheduledStartTime) {
            throw new NoPrepSlotError(row.id);
          }
          return res.scheduledStartTime;
        },
      );
      return { status: "PLACED", sessionId: row.id, startsAt: placed };
    } catch (err) {
      if (err instanceof NoPrepSlotError) return { status: "SKIPPED_NO_SLOT" };
      throw err;
    }
  }
}
