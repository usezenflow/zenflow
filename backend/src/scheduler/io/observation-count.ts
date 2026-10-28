import { Prisma, SessionEventType } from "../../../generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * Events that carry a learning signal (ADR-0042): a graded `MOVE` and a
 * `KEPT`. `CREATE` and `SYSTEM_MOVE` carry none.
 */
export function rewardEventWhere(
  userId: string,
): Prisma.SessionEventWhereInput {
  return {
    userId,
    eventType: { in: [SessionEventType.MOVE, SessionEventType.KEPT] },
  };
}

/**
 * The user's reward-event count, the input to the adaptive LinUCB/preference
 * weights and the `SlotProposal.observationCount` stamp.
 */
export function loadObservationCount(
  prisma: Pick<PrismaService, "sessionEvent">,
  userId: string,
): Promise<number> {
  return prisma.sessionEvent.count({ where: rewardEventWhere(userId) });
}
