import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  SeriesSession,
  Session as SharedSession,
} from "@zenflow/shared";
import { Prisma, type SessionSeries, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { wouldConflict } from "../scheduler/io/conflict-check";
import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  rruleWithUntil,
  reanchorTimeOfDay,
} from "../scheduler/core/recurrence";
import { MAX_SCAN_DAYS } from "../scheduler/constants";
import { DAY_MS, localDateStr } from "../scheduler/core/slot";
import { minutesToUtc } from "../common/utils";
import { SessionRow, WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSeriesSessionDto, toSessionDto } from "./session-mapper";
import { createEventData, recordCreateEvent } from "./session-events";
import { placeOrDiscard } from "./placement-compensation";

/**
 * Shown when a `TASK` (or series, or a series being grown) has no feasible
 * slot anywhere between now and its deadline — {@link SessionCrudService.create}'s
 * and {@link SeriesService.resizeSessionCount}'s pre-flight checks reject the
 * whole operation with this message before inserting anything, so nothing
 * accumulates half-placed. A `"\n"` splits a short title from its description —
 * the mobile client's `splitToastMessage` renders the two lines separately
 * instead of one long wrapped, bold line.
 */
export const NO_FEASIBLE_SLOT_MESSAGE =
  "No open slot before the deadline\nLoosen the deadline or reduce the number of sessions, then try again.";

/**
 * Every `SessionSeries` lifecycle op — the `sessionCount > 1` `TASK` batch, its
 * deadline redistribution, and the four ways to delete part or all of a series
 * (issue #32). `SessionsService` delegates the matching endpoints here; recurring
 * fixed-type series are created in `SessionCrudService` (they need no placement).
 */
@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly taskPlacement: TaskPlacementService,
  ) {}

  /**
   * "Delete just this occurrence" of a recurring series — append the instant to
   * `SessionSeries.exdates` so `expandRrule` skips it. Idempotent. The
   * representative row is never touched.
   */
  async excludeOccurrence(
    seriesId: string,
    startISO: string,
    user: User,
  ): Promise<RemoveSessionResponse> {
    const canonical = new Date(startISO).toISOString();
    const series = await this.prisma.sessionSeries.findFirst({
      where: { id: seriesId, userId: user.id },
      select: { id: true, rrule: true, exdates: true },
    });
    if (!series || !series.rrule)
      throw new NotFoundException(`Cannot find recurring series ${seriesId}`);

    if (
      !series.exdates.some(
        (e) => new Date(e).getTime() === new Date(canonical).getTime(),
      )
    ) {
      await this.prisma.sessionSeries.update({
        where: { id: seriesId },
        data: { exdates: { push: canonical } },
      });
    }
    return { id: occurrenceId(seriesId, new Date(canonical)) };
  }

  /**
   * A series-wide time-of-day change moves every occurrence start, so each
   * linked prep plan's occurrence start moves with it.
   */
  async shiftPrepOccurrences(
    repId: string,
    newRepStart: Date,
    user: User,
  ): Promise<void> {
    const preps = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        prepForSessionId: repId,
        prepForOccurrenceStart: { not: null },
      },
      select: { id: true, prepForOccurrenceStart: true },
    });
    for (const prep of preps) {
      await this.prisma.session.update({
        where: { id: prep.id },
        data: {
          prepForOccurrenceStart: reanchorTimeOfDay(
            prep.prepForOccurrenceStart as Date,
            newRepStart,
            user.timezone,
          ),
        },
      });
    }
  }

  /**
   * "This occurrence only" move of a recurring fixed series: the occurrence is
   * excluded from the series (see {@link excludeOccurrence}) and created again
   * as a one-off at its new start. The rest of the series keeps its time.
   */
  async detachOccurrence(
    seriesId: string,
    occurrenceStartISO: string,
    change: { scheduledStartTime: string; durationMinutes: number },
    user: User,
  ): Promise<SharedSession> {
    const rep = await this.prisma.session.findFirst({
      where: { seriesId, userId: user.id, deleted: false },
      orderBy: { createdAt: "asc" },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!rep)
      throw new NotFoundException(`Cannot find recurring series ${seriesId}`);

    await this.excludeOccurrence(seriesId, occurrenceStartISO, user);
    const created = await this.prisma.$transaction(async (tx) => {
      const s = await tx.session.create({
        data: {
          type: rep.type,
          source: rep.source,
          title: rep.title,
          note: rep.note,
          location: rep.location,
          durationMinutes: change.durationMinutes,
          deadline: null,
          scheduledStartTime: new Date(change.scheduledStartTime),
          tags: { connect: rep.tags.map((t) => ({ id: t.id })) },
          userId: user.id,
        },
        include: WITH_TAGS_AND_SERIES,
      });
      await tx.sessionEvent.create({ data: createEventData(s, user.id) });
      recordCreateEvent();
      // The occurrence gets a new id; its prep plans follow it.
      await tx.session.updateMany({
        where: {
          userId: user.id,
          deleted: false,
          prepForSessionId: rep.id,
          prepForOccurrenceStart: new Date(occurrenceStartISO),
        },
        data: { prepForSessionId: s.id, prepForOccurrenceStart: null },
      });
      return s;
    });
    return toSessionDto(created);
  }

  /**
   * "Delete this occurrence and every one after it" — pull the series' `rrule`
   * `UNTIL` back to just before `fromStartISO`. If the cutoff lands on or before
   * the first occurrence, the whole series is deleted instead.
   */
  async truncateFrom(
    seriesId: string,
    fromStartISO: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const from = new Date(fromStartISO);
    if (Number.isNaN(from.getTime()))
      throw new NotFoundException(`Invalid occurrence start "${fromStartISO}"`);

    return this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.findFirst({
        where: { id: seriesId, userId: user.id },
        include: {
          sessions: { select: { id: true, scheduledStartTime: true } },
        },
      });
      if (!series || !series.rrule)
        throw new NotFoundException(`Cannot find recurring series ${seriesId}`);

      const rep = series.sessions[0];
      const until = new Date(from.getTime() - 1000); // 1s before the cutoff occurrence

      if (rep?.scheduledStartTime && until < rep.scheduledStartTime) {
        const removedSessionIds = series.sessions.map((s) => s.id);
        await tx.sessionSeries.delete({ where: { id: seriesId } });
        return { seriesId, removedSessionIds, seriesGone: true };
      }

      await tx.sessionSeries.update({
        where: { id: seriesId },
        data: {
          rrule: rruleWithUntil(series.rrule, until),
          exdates: series.exdates.filter(
            (e) => new Date(e).getTime() < until.getTime(),
          ),
        },
      });
      return { seriesId, removedSessionIds: [], seriesGone: false };
    });
  }

  /**
   * A `TASK` series' "this and later sittings" / "all sittings" reschedule
   * (issue: drag/resize confirmation scopes). Every affected sibling KEEPS
   * its own calendar date — only its time-of-day (and, if resized, its
   * duration) changes, so no sitting's date ever shifts. Reuses `removeFrom`'s
   * sibling-selection shape: `following` = every sitting whose `sessionIndex`
   * is ≥ the anchor's (falling back to `createdAt` order when `sessionIndex`
   * is unset), `scopeAll` = every sitting in the series.
   *
   * With `skipConflicting`, each candidate landing is checked via
   * {@link wouldConflict} (excluding every id in this series, since a
   * materialized TASK series never lands its own sittings on top of each
   * other) — a sitting whose new landing would overlap something else is left
   * untouched and its id recorded in `skippedSessionIds`.
   *
   * Returns every member (`sessionIndex` order, same shape {@link redistribute}
   * returns) — untouched/skipped members come back with their prior state.
   */
  async updateSiblingTimeOfDay(
    seriesId: string,
    anchorSessionId: string,
    change: { timeOfDayMinutes: number; durationMinutes?: number },
    scopeAll: boolean,
    skipConflicting: boolean,
    user: User,
  ): Promise<{ sessions: SeriesSession[]; skippedSessionIds: string[] }> {
    return this.prisma.$transaction(async (tx) => {
      const members = await tx.session.findMany({
        where: { seriesId, userId: user.id, deleted: false },
        include: WITH_TAGS_AND_SERIES,
        orderBy: [{ sessionIndex: "asc" }, { createdAt: "asc" }],
      });
      if (members.length === 0)
        throw new NotFoundException(`Cannot find series with id ${seriesId}`);

      const anchor = members.find((m) => m.id === anchorSessionId);
      if (!anchor)
        throw new NotFoundException(
          `Session ${anchorSessionId} is not part of series ${seriesId}`,
        );

      const targets = scopeAll
        ? members
        : anchor.sessionIndex != null
          ? members.filter(
              (m) =>
                m.sessionIndex != null &&
                m.sessionIndex >= (anchor.sessionIndex as number),
            )
          : members.filter(
              (m) => m.createdAt.getTime() >= anchor.createdAt.getTime(),
            );

      const allMemberIds = members.map((m) => m.id);
      const skippedSessionIds: string[] = [];
      const updatedById = new Map<string, SessionRow>();

      for (const sibling of targets) {
        // No date to keep for a not-yet-placed sitting — nothing to re-anchor.
        if (!sibling.scheduledStartTime) continue;

        const dayStr = localDateStr(sibling.scheduledStartTime, user.timezone);
        const newStart = minutesToUtc(
          dayStr,
          change.timeOfDayMinutes,
          user.timezone,
        );
        const newDuration = change.durationMinutes ?? sibling.durationMinutes;

        if (skipConflicting) {
          const conflict = await wouldConflict(tx, {
            userId: user.id,
            timezone: user.timezone,
            start: newStart,
            durationMinutes: newDuration,
            excludeSessionIds: allMemberIds,
            excludeSeriesId: seriesId,
          });
          if (conflict) {
            skippedSessionIds.push(sibling.id);
            continue;
          }
        }

        const row = await tx.session.update({
          where: { id: sibling.id },
          data: { scheduledStartTime: newStart, durationMinutes: newDuration },
          include: WITH_TAGS_AND_SERIES,
        });
        updatedById.set(sibling.id, row);
      }

      const sessions = members.map((m) =>
        toSeriesSessionDto(updatedById.get(m.id) ?? m),
      );
      return { sessions, skippedSessionIds };
    });
  }

  /**
   * A recurring fixed series' "this and following" reschedule — no
   * per-occurrence detach primitive exists, so this is the finest granularity
   * a recurring drag/resize can target. Reuses {@link truncateFrom} to cut the
   * OLD series off just before `fromOccurrenceStartISO` (or delete it outright
   * if the cutoff lands on/before its first occurrence), then spins up a brand
   * new `SessionSeries` + representative `Session` — same type/title/note/tags
   * and the SAME rrule pattern — anchored at the new date/time going forward.
   *
   * With `skipConflicting`, every occurrence of the NEW series up to
   * {@link MAX_SCAN_DAYS} out is expanded ({@link expandRrule}) and checked via
   * {@link wouldConflict} (excluding the new series' own row); a conflicting
   * occurrence is pushed onto the new series' `exdates` via
   * {@link excludeOccurrence} — same primitive "delete just this occurrence"
   * uses — rather than moved on top of something else.
   */
  async updateRecurringFollowing(
    seriesId: string,
    fromOccurrenceStartISO: string,
    change: { scheduledStartTime: string; durationMinutes: number },
    skipConflicting: boolean,
    user: User,
  ): Promise<{ session: SharedSession; skippedSessionIds: string[] }> {
    const oldSeries = await this.prisma.sessionSeries.findFirst({
      where: { id: seriesId, userId: user.id },
      include: {
        sessions: {
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: WITH_TAGS_AND_SERIES,
        },
      },
    });
    const rep = oldSeries?.sessions[0];
    if (!oldSeries || !oldSeries.rrule || !rep)
      throw new NotFoundException(`Cannot find recurring series ${seriesId}`);
    const rrule = oldSeries.rrule;

    const prepsToCarry = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        prepForSessionId: rep.id,
        prepForOccurrenceStart: { gte: new Date(fromOccurrenceStartISO) },
      },
      select: { id: true, prepForOccurrenceStart: true },
    });

    await this.truncateFrom(seriesId, fromOccurrenceStartISO, user);

    const newStart = new Date(change.scheduledStartTime);
    const repStart = firstOccurrence(rrule, newStart, user.timezone);

    const created = await this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.create({
        data: { type: rep.type, rrule, deadline: null, userId: user.id },
      });
      const s = await tx.session.create({
        data: {
          type: rep.type,
          source: rep.source,
          title: rep.title,
          note: rep.note,
          location: rep.location,
          durationMinutes: change.durationMinutes,
          deadline: null,
          scheduledStartTime: repStart,
          seriesId: series.id,
          tags: { connect: rep.tags.map((t) => ({ id: t.id })) },
          userId: user.id,
        },
        include: WITH_TAGS_AND_SERIES,
      });
      await tx.sessionEvent.create({
        data: createEventData(s, user.id, series.id),
      });
      recordCreateEvent();
      // Later occurrences now belong to the new series; their prep plans follow.
      for (const prep of prepsToCarry) {
        if (!prep.prepForOccurrenceStart) continue;
        const at = reanchorTimeOfDay(
          prep.prepForOccurrenceStart,
          newStart,
          user.timezone,
        );
        const exists =
          expandRrule(
            rrule,
            repStart,
            at,
            new Date(at.getTime() + 1),
            user.timezone,
            [],
          ).length > 0;
        if (!exists) continue;
        await tx.session.update({
          where: { id: prep.id },
          data: { prepForSessionId: s.id, prepForOccurrenceStart: at },
        });
      }
      return s;
    });

    const skippedSessionIds: string[] = [];
    if (skipConflicting) {
      const scanEnd = new Date(repStart.getTime() + MAX_SCAN_DAYS * DAY_MS);
      const occStarts = expandRrule(
        rrule,
        repStart,
        repStart,
        scanEnd,
        user.timezone,
      );
      for (const occStart of occStarts) {
        const conflict = await wouldConflict(this.prisma, {
          userId: user.id,
          timezone: user.timezone,
          start: occStart,
          durationMinutes: change.durationMinutes,
          excludeSessionIds: [created.id],
          excludeSeriesId: created.seriesId as string,
        });
        if (conflict) {
          await this.excludeOccurrence(
            created.seriesId as string,
            occStart.toISOString(),
            user,
          );
          skippedSessionIds.push(
            occurrenceId(created.seriesId as string, occStart),
          );
        }
      }
    }

    return { session: toSessionDto(created), skippedSessionIds };
  }

  /**
   * Delete a whole series in one action (issue #32) — every session (cascade),
   * then the `SessionSeries` row. Also the "undo the batch" action.
   */
  async removeSeries(
    seriesId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.findFirst({
        where: { id: seriesId, userId: user.id },
        include: { sessions: { select: { id: true } } },
      });
      if (!series)
        throw new NotFoundException(`Cannot find series with id ${seriesId}`);

      const removedSessionIds = series.sessions.map((s) => s.id);
      await tx.sessionSeries.delete({ where: { id: seriesId } });
      return { seriesId, removedSessionIds, seriesGone: true };
    });
  }

  /**
   * Delete one session and every later one in the same series (`sessionIndex`
   * order, then `createdAt`), keeping the earlier ones and the series row (issue
   * #32). If nothing remains, the series row goes too.
   */
  async removeFrom(
    seriesId: string,
    sessionId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.findFirst({
        where: { id: seriesId, userId: user.id },
        include: {
          sessions: {
            select: { id: true, sessionIndex: true, createdAt: true },
            orderBy: [{ sessionIndex: "asc" }, { createdAt: "asc" }],
          },
        },
      });
      if (!series)
        throw new NotFoundException(`Cannot find series with id ${seriesId}`);

      const anchor = series.sessions.find((s) => s.id === sessionId);
      if (!anchor)
        throw new NotFoundException(
          `Session ${sessionId} is not part of series ${seriesId}`,
        );

      const doomed =
        anchor.sessionIndex != null
          ? series.sessions.filter(
              (s) =>
                s.sessionIndex != null &&
                s.sessionIndex >= (anchor.sessionIndex as number),
            )
          : series.sessions.filter(
              (s) => s.createdAt.getTime() >= anchor.createdAt.getTime(),
            );
      const removedSessionIds = doomed.map((s) => s.id);

      await tx.session.deleteMany({
        where: { id: { in: removedSessionIds }, userId: user.id },
      });

      const seriesGone = removedSessionIds.length >= series.sessions.length;
      if (seriesGone) {
        await tx.sessionSeries.delete({ where: { id: seriesId } });
      }
      return { seriesId, removedSessionIds, seriesGone };
    });
  }
}
