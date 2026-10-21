import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SessionSkipResponse } from "@zenflow/shared";
import { SessionType, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { expandRrule, parseOccurrenceId } from "../scheduler/core/recurrence";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";

/**
 * How far a skip reaches on a recurring lecture: the one occurrence, it and
 * every later one, or the whole series (exempt).
 */
export type SkipScope = "occurrence" | "following" | "all";

const TASK_SKIP_MESSAGE = "Tasks cannot be skipped";

/**
 * Skipped state for calendar sessions other than `TASK` (ADR-0035). A `TASK`
 * is learned from its START and MOVE events, so it is never skipped. A plain
 * row stores the state on `Session`; a recurring occurrence id
 * (`<seriesId>::<startISO>`) stores it on `SessionOccurrenceState`, so the
 * series stays virtual. Skipping writes no `SessionEvent`.
 */
@Injectable()
export class SessionSkipService {
  constructor(private readonly prisma: PrismaService) {}

  async set(
    id: string,
    on: boolean,
    user: User,
    scope: SkipScope = "occurrence",
  ): Promise<SessionSkipResponse> {
    const occ = parseOccurrenceId(id);
    if (scope !== "occurrence" && !occ)
      throw new BadRequestException(
        "Skip scope needs a recurring occurrence id",
      );
    const session = occ
      ? await this.setOccurrence(id, occ, on, user)
      : await this.setRow(id, on, user);
    if (occ && scope !== "occurrence")
      await this.setSeriesSkip(occ, scope, on, user);
    return { session };
  }

  /**
   * Skip every meeting in `sessionId`'s timetable group (`scheduleStudyUnitId`),
   * or only those at or after it (`from`). Each goes through {@link set}, so
   * state matches a single skip. 404 when the session isn't the caller's,
   * doesn't exist, or isn't a grouped timetable meeting.
   */
  async skipTimetableGroup(
    sessionId: string,
    from: boolean,
    user: User,
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
      await this.set(t.id, true, user);
      skippedSessionIds.push(t.id);
    }
    return { skippedSessionIds };
  }

  private async setRow(id: string, on: boolean, user: User) {
    const row = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!row) throw new NotFoundException(`Cannot find session with id ${id}`);
    if (row.type === SessionType.TASK)
      throw new BadRequestException(TASK_SKIP_MESSAGE);
    if (row.series?.rrule)
      throw new BadRequestException("Use the occurrence id");
    if (!row.scheduledStartTime)
      throw new BadRequestException("Session is not scheduled");

    const updated = await this.prisma.session.update({
      where: { id: row.id },
      data: { skipped: on },
      include: WITH_TAGS_AND_SERIES,
    });
    return toSessionDto(updated);
  }

  private async setOccurrence(
    id: string,
    occ: { seriesId: string; startISO: string },
    on: boolean,
    user: User,
  ) {
    const start = new Date(occ.startISO);
    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (rep?.type === SessionType.TASK)
      throw new BadRequestException(TASK_SKIP_MESSAGE);
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
    if (on) {
      await this.prisma.sessionOccurrenceState.upsert({
        where: key,
        create: {
          seriesId: occ.seriesId,
          occurrenceStart: start,
          userId: user.id,
          skipped: true,
        },
        update: { skipped: true },
      });
    } else {
      await this.prisma.sessionOccurrenceState.deleteMany({
        where: { seriesId: occ.seriesId, occurrenceStart: start },
      });
    }

    return {
      ...toSessionDto(rep),
      id,
      scheduledStartTime: start.toISOString(),
      skipped: on,
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
}
