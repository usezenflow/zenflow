import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import type { SessionDoneResponse } from "@zenflow/shared";
import {
  SessionEventType,
  SessionSource,
  SessionType,
  type User,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  PREFERENCE_KEPT_WEIGHT,
  SESSION_DONE_REWARD,
} from "../scheduler/constants";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionSnapshot } from "./session-mapper";
import { recordSessionEvent } from "./session-events";

/**
 * One-tap Done on a placed TASK. Writes a `DONE` `SessionEvent` and dispatches
 * a delayed LinUCB reward (+1.0) plus preference-matrix reinforcement, so the
 * bandit learns from the completion signal (ADR-0035).
 */
@Injectable()
export class SessionDoneService {
  private readonly logger = new Logger(SessionDoneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  async mark(
    id: string,
    user: User,
    now: Date = new Date(),
  ): Promise<SessionDoneResponse> {
    const row = await this.placedTask(id, user);
    const existing = await this.prisma.sessionEvent.findFirst({
      where: {
        sessionId: row.id,
        userId: user.id,
        eventType: SessionEventType.DONE,
      },
      select: { id: true },
    });
    if (existing) return { done: true };

    const start = row.scheduledStartTime!.getTime();
    if (now.getTime() < start)
      throw new BadRequestException("This task hasn't started yet. Mark it done once it's in progress or done.");
    const event = await this.prisma.sessionEvent.create({
      data: {
        sessionId: row.id,
        userId: user.id,
        eventType: SessionEventType.DONE,
        newSnapshot: toSessionSnapshot(row),
        rewardScore: SESSION_DONE_REWARD,
        occurredAt: now,
      },
      select: { id: true },
    });
    recordSessionEvent(SessionEventType.DONE);
    await this.applyReward(user, row.id, event.id, start);
    return { done: true };
  }

  async isDone(id: string, user: User): Promise<boolean> {
    const event = await this.prisma.sessionEvent.findFirst({
      where: {
        sessionId: id,
        userId: user.id,
        eventType: SessionEventType.DONE,
      },
      select: { id: true },
    });
    return event !== null;
  }

  /** Undo: removes the Done events of this TASK. */
  async clear(id: string, user: User): Promise<SessionDoneResponse> {
    const row = await this.placedTask(id, user);
    await this.prisma.sessionEvent.deleteMany({
      where: {
        sessionId: row.id,
        userId: user.id,
        eventType: SessionEventType.DONE,
      },
    });
    return { done: false };
  }

  private async placedTask(id: string, user: User) {
    const row = await this.prisma.session.findFirst({
      where: {
        id,
        userId: user.id,
        deleted: false,
        type: SessionType.TASK,
        source: { in: [SessionSource.USER, SessionSource.AUTO] },
        scheduledStartTime: { not: null },
      },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!row)
      throw new NotFoundException(`Cannot find placed task with id ${id}`);
    return row;
  }

  /**
   * Best-effort, after the event is written. Folds the DONE reward into the
   * LinUCB arm that placed the session, and reinforces the preference matrix.
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
      SESSION_DONE_REWARD,
      null,
    );
    await this.schedulingFeedback.reinforcePreferenceMatrix(
      user.id,
      startMs,
      user.timezone,
      PREFERENCE_KEPT_WEIGHT * SESSION_DONE_REWARD,
    );
  }
}
