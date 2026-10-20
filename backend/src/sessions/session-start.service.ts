import { Injectable } from "@nestjs/common";
import type { SessionStartResponse } from "@zenflow/shared";
import {
  SessionEventType,
  SessionSource,
  SessionType,
  type User,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionSnapshot } from "./session-mapper";
import { recordSessionEvent } from "./session-events";

/**
 * Records that the user opened the app inside a placed block: one `START`
 * `SessionEvent` per unmoved placement, written only while `now` is inside its
 * slot. The outcome sweep settles the reward from the first one (ADR-0025).
 */
@Injectable()
export class SessionStartService {
  constructor(private readonly prisma: PrismaService) {}

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
        retainedAt: null,
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

    await this.prisma.sessionEvent.create({
      data: {
        sessionId: row.id,
        userId: user.id,
        eventType: SessionEventType.START,
        newSnapshot: toSessionSnapshot(row),
        occurredAt: now,
      },
    });
    recordSessionEvent(SessionEventType.START);
    return { recorded: true };
  }
}
