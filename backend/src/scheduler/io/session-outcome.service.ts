import { Injectable, Logger, Optional } from "@nestjs/common";
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
  SESSION_COMPLETED_REWARD,
  SESSION_LAPSED_REWARD,
  SESSION_SKIPPED_REWARD,
  SESSION_STARTED_REWARD,
  SESSION_WRONG_TIME_REWARD,
} from "../constants";
import { completionOutcome, type CompletionOutcome } from "../core/reward";
import { SpiritsService } from "../../spirits/spirits.service";
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
    completedAt: true;
    skipped: true;
    tags: { select: { name: true } };
    user: { select: { timezone: true } };
  };
}>;

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
 * A row qualifies when it is a user-created `TASK` with a `scheduledStartTime`,
 * has never been moved (`lastMovedAt == null`) and is not yet settled
 * (`retainedAt == null`; the column stamps the settlement). The pure
 * {@link completionReward} decides the outcome:
 *
 * - checked off inside the slot: `DONE`, `+1`, settled at `end + grace`;
 * - started inside the slot without a check-off: `STARTED`, `+1`;
 * - skipped: `SKIPPED`, `0`, settled at `end + grace`;
 * - checked off before the start: `WRONG_TIME`, `0`, settled at `end + cutoff`;
 * - no start or check-off by `end + cutoff`: `LAPSED`, `-0.25`.
 *
 * The settled reward is delivered to the LinUCB arm behind the placement via
 * {@link SchedulingFeedbackService.applyDelayedReward}. The same reward also
 * reinforces the user's preference matrix at the kept hour, scaled by
 * `PREFERENCE_RETAINED_WEIGHT`.
 */
/** Reward written on the settled event, per outcome. */
const OUTCOME_REWARD: Record<CompletionOutcome, number> = {
  DONE: SESSION_COMPLETED_REWARD,
  STARTED: SESSION_STARTED_REWARD,
  SKIPPED: SESSION_SKIPPED_REWARD,
  WRONG_TIME: SESSION_WRONG_TIME_REWARD,
  LAPSED: SESSION_LAPSED_REWARD,
};

/** The event a user writes for an outcome they chose; the outcome updates its reward. */
const USER_EVENT_OF: Partial<Record<CompletionOutcome, SessionEventType>> = {
  DONE: SessionEventType.COMPLETE,
  SKIPPED: SessionEventType.SKIP,
};

/** The event written when the system settles an outcome with no user event. */
const EVENT_OF: Record<CompletionOutcome, SessionEventType> = {
  DONE: SessionEventType.COMPLETE,
  STARTED: SessionEventType.START,
  SKIPPED: SessionEventType.SKIP,
  WRONG_TIME: SessionEventType.WRONG_TIME,
  LAPSED: SessionEventType.LAPSED,
};

@Injectable()
export class SessionOutcomeService {
  private readonly logger = new Logger(SessionOutcomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
    @Optional() private readonly spirits?: SpiritsService,
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
        await this.creditSparks(settled, now);
      }

      if (candidates.length < OUTCOME_BATCH_SIZE) break;
    }

    return total;
  }

  /** A settled `START` is a spark: credit each user once per batch. */
  private async creditSparks(settled: Settled[], now: Date): Promise<void> {
    if (!this.spirits) return;
    const users = new Set(
      settled.filter((s) => s.outcome === "STARTED").map((s) => s.userId),
    );
    for (const userId of users) await this.spirits.credit(userId, now);
  }

  private findCandidateBatch(
    userId: string | undefined,
    cursor: string | undefined,
  ): Promise<OutcomeCandidate[]> {
    return this.prisma.session.findMany({
      where: {
        type: SessionType.TASK,
        source: SessionSource.USER,
        prepForSessionId: null,
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
        completedAt: true,
        skipped: true,
        tags: { select: { name: true } },
        user: { select: { timezone: true } },
      },
      orderBy: { id: "asc" },
      take: OUTCOME_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  /** Candidates whose outcome is settled at `now`; the rest are stepped over. */
  private decideOutcomes(
    candidates: OutcomeCandidate[],
    now: Date,
  ): { session: OutcomeCandidate; outcome: CompletionOutcome }[] {
    const out: { session: OutcomeCandidate; outcome: CompletionOutcome }[] = [];
    for (const session of candidates) {
      const start = session.scheduledStartTime!.getTime();
      const outcome = completionOutcome(
        start,
        start + session.durationMinutes * 60_000,
        session.completedAt ? session.completedAt.getTime() : null,
        session.skipped,
        now.getTime(),
        null,
      );
      if (outcome) out.push({ session, outcome });
    }
    return out;
  }

  private async settleBatch(
    outcomes: { session: OutcomeCandidate; outcome: CompletionOutcome }[],
    now: Date,
  ): Promise<Settled[]> {
    const settled: Settled[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const { session, outcome } of outcomes) {
        // Claim: an overlapping sweep (two workers during a deploy) loses the
        // race here and must not double-record the event or reward.
        const claimed = await tx.session.updateMany({
          where: { id: session.id, retainedAt: null },
          data: { retainedAt: now },
        });
        if (claimed.count === 0) continue;
        const eventId = await this.writeOutcomeEvent(tx, session, outcome);
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
   * Sets the reward on the check-off `SessionEvent` the user wrote (`COMPLETE`
   * or `SKIP`), or writes the outcome's own event when there is none. Returns the id
   * of the event that carries the reward.
   */
  private async writeOutcomeEvent(
    tx: Prisma.TransactionClient,
    session: OutcomeCandidate,
    outcome: CompletionOutcome,
  ): Promise<bigint> {
    const checkOff = USER_EVENT_OF[outcome] ?? null;
    const reward = OUTCOME_REWARD[outcome];

    if (checkOff) {
      const existing = await tx.sessionEvent.findFirst({
        where: {
          sessionId: session.id,
          userId: session.userId,
          eventType: checkOff,
        },
        orderBy: { occurredAt: "desc" },
        select: { id: true },
      });
      if (existing) {
        await tx.sessionEvent.updateMany({
          where: { id: existing.id },
          data: { rewardScore: reward },
        });
        return existing.id;
      }
    }

    const event = await tx.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: session.userId,
        eventType: checkOff ?? EVENT_OF[outcome],
        oldSnapshot: Prisma.JsonNull,
        newSnapshot: this.snapshot(session),
        rewardScore: reward,
      },
      select: { id: true },
    });
    schedulerSessionEvents.add(1, {
      type: checkOff ?? EVENT_OF[outcome],
    });
    return event.id;
  }

  /** Delayed LinUCB reward and, for a completion, preference-matrix
   * reinforcement. Best-effort, outside the transaction. A placement that
   * was not chosen by LinUCB gets no bandit update; the matrix is updated
   * for either policy. */
  private async applyDelayedRewards(settled: Settled[]): Promise<void> {
    for (const s of settled) {
      await this.schedulingFeedback.applyDelayedReward(
        s.userId,
        s.sessionId,
        s.eventId,
        s.reward,
        null,
      );
      // The kept hour learns from what the student did there: started or done
      // raises it, a lapse lowers it, a skip or a wrong-time check-off leaves it.
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
