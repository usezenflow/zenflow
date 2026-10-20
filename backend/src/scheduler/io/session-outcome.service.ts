import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  Prisma,
  SessionEventType,
  SessionSource,
  SessionType,
} from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { OUTCOME_BATCH_SIZE } from "../../common/constants";
import {
  PREFERENCE_RETAINED_WEIGHT,
  SESSION_LAPSED_REWARD,
  SESSION_STARTED_REWARD,
} from "../constants";
import { completionOutcome, type CompletionOutcome } from "../core/reward";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { runCronJob } from "../../observability/cron";
import { schedulerSessionEvents } from "../../observability/metrics";

type OutcomeCandidate = Prisma.SessionGetPayload<{
  select: {
    id: true;
    userId: true;
    type: true;
    scheduledStartTime: true;
    durationMinutes: true;
    events: { select: { id: true; occurredAt: true } };
    tags: { select: { name: true } };
    user: { select: { timezone: true } };
  };
}>;

type Decided = {
  session: OutcomeCandidate;
  outcome: CompletionOutcome;
  /** The START event that proves the outcome, when it is `STARTED`. */
  startEventId: bigint | null;
};

type Settled = {
  sessionId: string;
  userId: string;
  eventId: bigint;
  outcome: CompletionOutcome;
  reward: number;
  scheduledStartMs: number;
  timezone: string;
};

/**
 * Half-hourly sweep that settles the outcome of an unmoved scheduled `TASK`
 * (ADR-0023). It is the only layer here that touches Prisma.
 *
 * A row qualifies when it is a `TASK` with a `scheduledStartTime` placed by the
 * user or by the system (prep), has never been moved (`lastMovedAt == null`) and
 * is not yet settled (`retainedAt == null`; the column stamps the settlement).
 * The pure {@link completionOutcome} decides the outcome:
 *
 * - a START inside the slot: `STARTED`, `+1`, settled at `end + grace`;
 * - no START by `end + cutoff`: `LAPSED`, `-0.25`.
 *
 * The settled reward is delivered to the LinUCB arm behind the placement via
 * {@link SchedulingFeedbackService.applyDelayedReward}. The same reward also
 * reinforces the user's preference matrix at the kept hour, scaled by
 * `PREFERENCE_RETAINED_WEIGHT`.
 */
/** Reward written on the settled event, per outcome. */
const OUTCOME_REWARD: Record<CompletionOutcome, number> = {
  STARTED: SESSION_STARTED_REWARD,
  LAPSED: SESSION_LAPSED_REWARD,
};

@Injectable()
export class SessionOutcomeService {
  private readonly logger = new Logger(SessionOutcomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  /** Every 30 minutes. `now` is injectable for tests. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron(): Promise<void> {
    await runCronJob("session-outcomes", async () => {
      const count = await this.sweep();
      if (count > 0) {
        this.logger.log(`Settled ${count} session outcome(s)`);
      }
    });
  }

  async sweep(now = new Date(), userId?: string): Promise<number> {
    let total = 0;
    let cursor: string | undefined;

    for (;;) {
      const candidates = await this.findCandidateBatch(userId, cursor);
      if (candidates.length === 0) break;
      cursor = candidates[candidates.length - 1].id;

      const outcomes = this.decideOutcomes(candidates, now);
      if (outcomes.length > 0) {
        const settled = await this.settleBatch(outcomes, now);
        total += settled.length;
        await this.applyDelayedRewards(settled);
      }

      if (candidates.length < OUTCOME_BATCH_SIZE) break;
    }

    return total;
  }

  private findCandidateBatch(
    userId: string | undefined,
    cursor: string | undefined,
  ): Promise<OutcomeCandidate[]> {
    return this.prisma.session.findMany({
      where: {
        type: SessionType.TASK,
        source: { in: [SessionSource.USER, SessionSource.AUTO] },
        retainedAt: null,
        lastMovedAt: null,
        deleted: false,
        scheduledStartTime: { not: null },
        ...(userId ? { userId } : {}),
      },
      select: {
        id: true,
        userId: true,
        type: true,
        scheduledStartTime: true,
        durationMinutes: true,
        events: {
          where: { eventType: SessionEventType.START },
          select: { id: true, occurredAt: true },
          orderBy: { occurredAt: "asc" },
        },
        tags: { select: { name: true } },
        user: { select: { timezone: true } },
      },
      orderBy: { id: "asc" },
      take: OUTCOME_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  /** Candidates whose outcome is settled at `now`; the rest are stepped over. */
  private decideOutcomes(candidates: OutcomeCandidate[], now: Date): Decided[] {
    const out: Decided[] = [];
    for (const session of candidates) {
      const start = session.scheduledStartTime!.getTime();
      const end = start + session.durationMinutes * 60_000;
      // The first START inside the slot is the one that counts.
      const startEvent = session.events.find(
        (e) => e.occurredAt.getTime() >= start && e.occurredAt.getTime() < end,
      );
      const outcome = completionOutcome(
        start,
        end,
        startEvent ? startEvent.occurredAt.getTime() : null,
        now.getTime(),
      );
      if (outcome)
        out.push({ session, outcome, startEventId: startEvent?.id ?? null });
    }
    return out;
  }

  private async settleBatch(
    outcomes: Decided[],
    now: Date,
  ): Promise<Settled[]> {
    const settled: Settled[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const { session, outcome, startEventId } of outcomes) {
        // Claim: an overlapping sweep (two workers during a deploy) loses the
        // race here and must not double-record the event or reward.
        const claimed = await tx.session.updateMany({
          where: { id: session.id, retainedAt: null },
          data: { retainedAt: now },
        });
        if (claimed.count === 0) continue;
        const eventId = await this.writeOutcomeEvent(
          tx,
          session,
          outcome,
          startEventId,
        );
        settled.push({
          sessionId: session.id,
          userId: session.userId,
          eventId,
          outcome,
          reward: OUTCOME_REWARD[outcome],
          scheduledStartMs: session.scheduledStartTime!.getTime(),
          timezone: session.user.timezone,
        });
      }
    });
    return settled;
  }

  /**
   * Sets the reward on the START event that proves a `STARTED` outcome, or
   * writes a `LAPSED` event. Returns the id of the event that carries the reward.
   */
  private async writeOutcomeEvent(
    tx: Prisma.TransactionClient,
    session: OutcomeCandidate,
    outcome: CompletionOutcome,
    startEventId: bigint | null,
  ): Promise<bigint> {
    const reward = OUTCOME_REWARD[outcome];

    if (startEventId !== null) {
      await tx.sessionEvent.updateMany({
        where: { id: startEventId },
        data: { rewardScore: reward },
      });
      return startEventId;
    }

    const eventType =
      outcome === "STARTED" ? SessionEventType.START : SessionEventType.LAPSED;
    const event = await tx.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: session.userId,
        eventType,
        oldSnapshot: Prisma.JsonNull,
        newSnapshot: this.snapshot(session),
        rewardScore: reward,
      },
      select: { id: true },
    });
    schedulerSessionEvents.add(1, { type: eventType });
    return event.id;
  }

  /** Delayed LinUCB reward and preference-matrix reinforcement. Best-effort,
   * outside the transaction. A placement that was not chosen by LinUCB gets
   * no bandit update; the matrix is updated for either policy. */
  private async applyDelayedRewards(settled: Settled[]): Promise<void> {
    for (const s of settled) {
      await this.schedulingFeedback.applyDelayedReward(
        s.userId,
        s.sessionId,
        s.eventId,
        s.reward,
        null,
      );
      // The kept hour learns from what the student did there: a start raises
      // it, a lapse lowers it.
      if (s.reward !== 0) {
        await this.schedulingFeedback.reinforcePreferenceMatrix(
          s.userId,
          s.scheduledStartMs,
          s.timezone,
          PREFERENCE_RETAINED_WEIGHT * s.reward,
        );
      }
    }
  }

  private snapshot(session: OutcomeCandidate): Prisma.InputJsonValue {
    return {
      scheduledStartTime: session.scheduledStartTime
        ? session.scheduledStartTime.toISOString()
        : null,
      durationMinutes: session.durationMinutes,
      type: session.type,
      tags: session.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    };
  }
}
