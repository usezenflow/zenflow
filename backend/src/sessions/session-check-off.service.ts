import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SessionCheckOffResponse } from "@zenflow/shared";
import { Prisma, SessionEventType, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { expandRrule, parseOccurrenceId } from "../scheduler/core/recurrence";
import { WITH_TAGS_AND_SERIES, type SessionRow } from "./types/session-row";
import { toSessionDto, toSessionSnapshot } from "./session-mapper";
import { recordSessionEvent } from "./session-events";

/** Which check-off a request sets or undoes. */
export type CheckOffKind = "complete" | "skip";

/**
 * How far a skip reaches on a recurring lecture: the one occurrence, it and
 * every later one, or the whole series (exempt).
 */
export type SkipScope = "occurrence" | "following" | "all";

interface CheckOffState {
  completedAt: Date | null;
  skipped: boolean;
}

const EMPTY: CheckOffState = { completedAt: null, skipped: false };

/** The state after setting (`on`) or undoing `kind`. Complete and skip exclude each other. */
export function nextCheckOffState(
  prev: CheckOffState,
  kind: CheckOffKind,
  on: boolean,
  now: Date,
): CheckOffState {
  if (kind === "complete")
    return on
      ? { completedAt: prev.completedAt ?? now, skipped: false }
      : { ...prev, completedAt: null };
  return on
    ? { completedAt: null, skipped: true }
    : { ...prev, skipped: false };
}

/**
 * Done and skipped state (issue #247): `POST|DELETE /sessions/:id/complete`
 * and `/skip`. A plain row stores it on `Session`; a recurring occurrence id
 * (`<seriesId>::<startISO>`) stores it on `SessionOccurrenceState`, so the
 * series stays virtual. Each transition writes or removes a `COMPLETE` /
 * `SKIP` `SessionEvent`, so one exists exactly while the state holds.
 */
@Injectable()
export class SessionCheckOffService {
  constructor(private readonly prisma: PrismaService) {}

  async set(
    id: string,
    kind: CheckOffKind,
    on: boolean,
    user: User,
    now: Date = new Date(),
    scope: SkipScope = "occurrence",
  ): Promise<SessionCheckOffResponse> {
    const occ = parseOccurrenceId(id);
    if (scope !== "occurrence" && !(occ && kind === "skip"))
      throw new BadRequestException(
        "Skip scope needs a recurring occurrence id",
      );
    const session = occ
      ? await this.setOccurrence(id, occ, kind, on, user, now)
      : await this.setRow(id, kind, on, user, now);
    if (occ && scope !== "occurrence")
      await this.setSeriesSkip(occ, scope, on, user);
    return { session };
  }

  /**
   * Skip every meeting in `sessionId`'s timetable group (`scheduleStudyUnitId`),
   * or only those at or after it (`from`). Each goes through {@link set}, so
   * state and `SKIP` events match a single skip. 404 when the session isn't the
   * caller's, doesn't exist, or isn't a grouped timetable meeting.
   */
  async skipTimetableGroup(
    sessionId: string,
    from: boolean,
    user: User,
    now: Date = new Date(),
  ): Promise<{ skippedSessionIds: string[] }> {
    const anchor = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
        deleted: false,
        scheduleStudyUnitId: { not: null },
      },
      select: { scheduleStudyUnitId: true, scheduledStartTime: true },
    });
    if (!anchor?.scheduleStudyUnitId)
      throw new NotFoundException(
        `Cannot find groupable timetable session ${sessionId}`,
      );
    const start = anchor.scheduledStartTime;
    if (from && !start)
      throw new BadRequestException("Session is not scheduled");

    const targets = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        scheduleStudyUnitId: anchor.scheduleStudyUnitId,
        scheduledStartTime: from && start ? { gte: start } : { not: null },
      },
      orderBy: { scheduledStartTime: "asc" },
      select: { id: true },
    });

    const skippedSessionIds: string[] = [];
    for (const t of targets) {
      await this.set(t.id, "skip", true, user, now);
      skippedSessionIds.push(t.id);
    }
    return { skippedSessionIds };
  }

  private async setRow(
    id: string,
    kind: CheckOffKind,
    on: boolean,
    user: User,
    now: Date,
  ) {
    const row = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!row) throw new NotFoundException(`Cannot find session with id ${id}`);
    if (row.series?.rrule)
      throw new BadRequestException("Use the occurrence id");
    if (!row.scheduledStartTime)
      throw new BadRequestException("Session is not scheduled");

    const prev = { completedAt: row.completedAt, skipped: row.skipped };
    const next = nextCheckOffState(prev, kind, on, now);
    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.session.update({
        where: { id: row.id },
        data: next,
        include: WITH_TAGS_AND_SERIES,
      });
      await this.syncEvents(tx, prev, next, {
        userId: user.id,
        row: s,
        start: row.scheduledStartTime as Date,
        matchStart: false,
      });
      return s;
    });
    return toSessionDto(updated);
  }

  private async setOccurrence(
    id: string,
    occ: { seriesId: string; startISO: string },
    kind: CheckOffKind,
    on: boolean,
    user: User,
    now: Date,
  ) {
    const start = new Date(occ.startISO);
    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    const exists =
      rep?.series?.rrule &&
      rep.scheduledStartTime &&
      expandRrule(
        rep.series.rrule,
        rep.scheduledStartTime,
        start,
        new Date(start.getTime() + 1),
        user.timezone,
        rep.series.exdates,
      ).length > 0;
    if (!rep || !exists)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    const key = {
      seriesId_occurrenceStart: {
        seriesId: occ.seriesId,
        occurrenceStart: start,
      },
    };
    const existing = await this.prisma.sessionOccurrenceState.findUnique({
      where: key,
    });
    const prev = existing
      ? { completedAt: existing.completedAt, skipped: existing.skipped }
      : EMPTY;
    const next = nextCheckOffState(prev, kind, on, now);

    await this.prisma.$transaction(async (tx) => {
      if (!next.completedAt && !next.skipped) {
        await tx.sessionOccurrenceState.deleteMany({
          where: { seriesId: occ.seriesId, occurrenceStart: start },
        });
      } else {
        await tx.sessionOccurrenceState.upsert({
          where: key,
          create: {
            seriesId: occ.seriesId,
            occurrenceStart: start,
            userId: user.id,
            ...next,
          },
          update: next,
        });
      }
      await this.syncEvents(tx, prev, next, {
        userId: user.id,
        row: rep,
        start,
        matchStart: true,
      });
    });

    return {
      ...toSessionDto(rep),
      id,
      scheduledStartTime: start.toISOString(),
      completedAt: next.completedAt?.toISOString() ?? null,
      skipped: next.skipped,
    };
  }

  /**
   * Exempt a recurring series from an occurrence on (`following`) or from its
   * first one (`all`). An open-ended series has no rows to write, so the
   * boundary lives on the series; undoing clears it.
   */
  private async setSeriesSkip(
    occ: { seriesId: string; startISO: string },
    scope: Exclude<SkipScope, "occurrence">,
    on: boolean,
    user: User,
  ): Promise<void> {
    const series = await this.prisma.sessionSeries.findFirst({
      where: { id: occ.seriesId, userId: user.id },
      select: {
        skippedFrom: true,
        sessions: {
          where: { deleted: false },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { scheduledStartTime: true },
        },
      },
    });
    if (!series) throw new NotFoundException("Cannot find recurring series");
    const first = series.sessions[0]?.scheduledStartTime;
    const from = scope === "all" && first ? first : new Date(occ.startISO);
    const next = on
      ? series.skippedFrom && series.skippedFrom <= from
        ? series.skippedFrom
        : from
      : null;
    await this.prisma.sessionSeries.update({
      where: { id: occ.seriesId },
      data: { skippedFrom: next },
    });
  }

  /** Write the event for a state turned on, delete the one for a state turned off. */
  private async syncEvents(
    tx: Prisma.TransactionClient,
    prev: CheckOffState,
    next: CheckOffState,
    ctx: { userId: string; row: SessionRow; start: Date; matchStart: boolean },
  ): Promise<void> {
    const transitions: [SessionEventType, boolean, boolean][] = [
      [SessionEventType.COMPLETE, !!prev.completedAt, !!next.completedAt],
      [SessionEventType.SKIP, prev.skipped, next.skipped],
    ];
    for (const [eventType, was, is] of transitions) {
      if (was === is) continue;
      if (is) {
        await tx.sessionEvent.create({
          data: {
            sessionId: ctx.row.id,
            userId: ctx.userId,
            eventType,
            newSnapshot: {
              ...(toSessionSnapshot(ctx.row) as Prisma.JsonObject),
              scheduledStartTime: ctx.start.toISOString(),
            },
          },
        });
        recordSessionEvent(eventType);
      } else {
        await tx.sessionEvent.deleteMany({
          where: {
            sessionId: ctx.row.id,
            userId: ctx.userId,
            eventType,
            ...(ctx.matchStart
              ? {
                  newSnapshot: {
                    path: ["scheduledStartTime"],
                    equals: ctx.start.toISOString(),
                  },
                }
              : {}),
          },
        });
      }
    }
  }
}
