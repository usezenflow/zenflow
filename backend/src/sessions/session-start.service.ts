import { Injectable } from "@nestjs/common";
import type { SessionStartResponse } from "@zenflow/shared";
import {
  SessionEventType,
  SessionSource,
  SessionType,
  type User,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  PREFERENCE_KEPT_WEIGHT,
  SESSION_STARTED_REWARD,
} from "../scheduler/constants";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionSnapshot } from "./session-mapper";
import { recordSessionEvent } from "./session-events";

/**
 * Records that the user opened the app inside a placed block: one `START`
 * `SessionEvent` per unmoved placement, written only while `now` is inside its
 * slot. START is telemetry only (ADR-0035): it carries `SESSION_STARTED_REWARD
 * = 0.0`, so LinUCB and the preference matrix do not learn from it. DONE is
 * the learning signal, written by {@link SessionDoneService}.
 */
@Injectable()
export class SessionStartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  async record(
    id: string,
    user: User,
    now: Date = new Date(),
  ): Promise<SessionStartResponse> {
    const row = await this.prisma.session.findFirst({
      where: {
        id,
        userId: user.id,
        deleted: false,
        type: SessionType.TASK,
        source: { in: [SessionSource.USER, SessionSource.AUTO] },
        lastMovedAt: null,
        scheduledStartTime: { not: null },
      },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!row?.scheduledStartTime) return { recorded: false };

    const start = row.scheduledStartTime.getTime();
    const end = start + row.durationMinutes * 60_000;
    if (now.getTime() < start || now.getTime() >= end)
      return { recorded: false };

    const existing = await this.prisma.sessionEvent.findFirst({
      where: {
        sessionId: row.id,
        userId: user.id,
        eventType: SessionEventType.START,
        occurredAt: { gte: row.scheduledStartTime, lt: new Date(end) },
      },
      select: { id: true },
    });
    if (existing) return { recorded: false };

    const event = await this.prisma.sessionEvent.create({
      data: {
        sessionId: row.id,
        userId: user.id,
        eventType: SessionEventType.START,
        newSnapshot: toSessionSnapshot(row),
        rewardScore: SESSION_STARTED_REWARD,
        occurredAt: now,
      },
      select: { id: true },
    });
    recordSessionEvent(SessionEventType.START);
    await this.applyReward(user, row.id, event.id, start);
    return { recorded: true };
  }

  /**
   * Best-effort, after the event is written. A placement LinUCB did not choose
   * gets no bandit update; the preference matrix learns from either policy.
   */
  private async applyReward(
    user: User,
    sessionId: string,
    eventId: bigint,
    startMs: number,
  ): Promise<void> {
    await this.schedulingFeedback.applyDelayedReward(
      user.id,
      sessionId,
      eventId,
      SESSION_STARTED_REWARD,
      null,
    );
    await this.schedulingFeedback.reinforcePreferenceMatrix(
      user.id,
      startMs,
      user.timezone,
      PREFERENCE_KEPT_WEIGHT * SESSION_STARTED_REWARD,
    );
  }
}
