import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  RemoveTimetableGroupResponse,
  Session as SharedSession,
  SessionDetailResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
} from "@zenflow/shared";
import { Prisma, type SessionType, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { displayDayRange } from "../scheduler/core/horizon";
import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  parseOccurrenceId,
} from "../scheduler/core/recurrence";
import { DAY_MS } from "../scheduler/core/slot";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { SessionRow, WITH_TAGS_AND_SERIES } from "./types/session-row";
import { PlacementNeedsConfirmationException } from "./placement-plan.exception";
import {
  slotProposalFieldsOf,
  toCreateSessionResponse,
  toSessionDto,
} from "./session-mapper";
import { createEventData, recordCreateEvent } from "./session-events";
import { insertFixedSession } from "./fixed-session-writer";
import { assertSyncedDeletable } from "./synced-lock";
import { mapSessionPrismaError } from "./prisma-error";
import { placeOrDiscard } from "./placement-compensation";
import { SeriesService } from "./series.service";

/** How far ahead, and how many occurrences, to look for the next unskipped class. */
const NEXT_OCCURRENCE_WINDOW_DAYS = 120;
const NEXT_OCCURRENCE_SCAN = 8;

type OccurrenceSkip = Pick<SharedSession, "skipped">;

const occurrenceStateKey = (seriesId: string, start: Date): string =>
  `${seriesId}|${start.getTime()}`;

/** An occurrence's skipped state; a missing row means not skipped. */
function occurrenceSkip(
  states: Map<string, OccurrenceSkip>,
  seriesId: string,
  start: Date,
  skippedFrom: Date | null = null,
): OccurrenceSkip {
  const state = states.get(occurrenceStateKey(seriesId, start)) ?? {
    skipped: false,
  };
  const exempt = skippedFrom !== null && start >= skippedFrom;
  return exempt && !state.skipped ? { skipped: true } : state;
}

/**
 * Plain session CRUD: `create` (dispatches by type — single `TASK`,
 * recurring-fixed, one-off-fixed), `list` (fans recurring reps into virtual occurrences),
 * `suggestions`, `findById`, `remove`. A single `TASK` create is placed via
 * {@link TaskPlacementService}; nothing else on the calendar moves. A `TASK`
 * (or series) with no feasible slot before its deadline is rejected by a
 * pre-flight check ({@link NO_FEASIBLE_SLOT_MESSAGE}) before anything is
 * inserted.
 */
@Injectable()
export class SessionCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly taskPlacement: TaskPlacementService,
    private readonly series: SeriesService,
  ) {}

  async create(
    dto: CreateSessionDto,
    user: User,
  ): Promise<CreateSessionResponse> {
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const now = new Date();

    if (dto.type === "TASK") {
      const deadline = new Date(dto.deadline as string);

      // Pre-flight feasibility — BEFORE any row is inserted, so an
      // infeasible request never leaves an unplaced task behind (no rollback
      // needed; see NO_FEASIBLE_SLOT_MESSAGE). A free slot, a flexible-task
      // repack, or the user's accept-conflicts / accept-late choice — else 409
      // (issue #62 B).
      await this.taskPlacement.preflightTask({
        user,
        durationMinutes: dto.durationMinutes,
        deadline,
        now,
        policy: dto.infeasiblePolicy,
      });
      return this.createSingleTask(dto, user, cleanTags, deadline, now);
    }

    if (dto.rrule) {
      return this.createFixedRecurring(dto, user, cleanTags);
    }
    return this.createFixedOneOff(dto, user, cleanTags);
  }

  /**
   * Inserts one unplaced `TASK` row and its CREATE event. Shared by the
   * create path and a confirmed create plan, which runs it in its own
   * transaction.
   */
  async insertSingleTask(
    tx: Prisma.TransactionClient,
    user: User,
    dto: CreateSessionDto,
    cleanTags: string[],
    deadline: Date,
    undoGroupId?: string,
  ): Promise<SessionRow> {
    const tagIds = await this.tagsService.resolveTagIds(tx, user.id, cleanTags);
    const prepFor = dto.prepForSessionId
      ? await this.resolvePrepTarget(tx, user, dto.prepForSessionId)
      : null;
    const s = await tx.session.create({
      data: {
        type: "TASK",
        source: "USER",
        prepForSessionId: prepFor?.id ?? null,
        prepForOccurrenceStart: prepFor?.occurrenceStart ?? null,
        title: dto.title,
        note: dto.note ?? null,
        location: dto.location ?? null,
        locationLat: dto.locationLat ?? null,
        locationLng: dto.locationLng ?? null,
        originLocation: dto.originLocation ?? null,
        originLat: dto.originLocation ? (dto.originLat ?? null) : null,
        originLng: dto.originLocation ? (dto.originLng ?? null) : null,
        commuteMinutes: dto.commuteMinutes ?? null,
        durationMinutes: dto.durationMinutes,
        deadline,
        tags: { connect: tagIds.map((id) => ({ id })) },
        userId: user.id,
      },
      include: WITH_TAGS_AND_SERIES,
    });
    await tx.sessionEvent.create({
      data: {
        ...createEventData(s, user.id),
        ...(undoGroupId ? { groupId: undoGroupId } : {}),
      },
    });
    recordCreateEvent();
    return s;
  }

  /**
   * The real row a prep `TASK` links to. A lecture occurrence id resolves to its
   * series representative plus the occurrence start. One live prep per target.
   */
  private async resolvePrepTarget(
    tx: Prisma.TransactionClient,
    user: User,
    ref: string,
  ): Promise<{ id: string; occurrenceStart: Date | null }> {
    const occ = parseOccurrenceId(ref);
    const target = await tx.session.findFirst({
      where: occ
        ? { seriesId: occ.seriesId, userId: user.id, deleted: false }
        : { id: ref, userId: user.id, deleted: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true },
    });
    if (!target)
      throw new NotFoundException(`Cannot find session with id ${ref}`);
    if (!["LECTURE", "EXAM", "ASSIGNMENT"].includes(target.type))
      throw new BadRequestException("Prep needs a lecture, exam or assignment");
    const occurrenceStart = occ ? new Date(occ.startISO) : null;
    const existing = await tx.session.findFirst({
      where: {
        userId: user.id,
        deleted: false,
        prepForSessionId: target.id,
        prepForOccurrenceStart: occurrenceStart,
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException("Prep already exists");
    return { id: target.id, occurrenceStart };
  }

  /** A flexible, deadline-driven `TASK` — inserted, then engine-placed. */
  private async createSingleTask(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
    deadline: Date,
    now: Date,
  ): Promise<CreateSessionResponse> {
    // One undo entry covers the create and whatever its placement displaced.
    const undoGroupId = randomUUID();
    const created = await this.prisma.$transaction((tx) =>
      this.insertSingleTask(tx, user, dto, cleanTags, deadline, undoGroupId),
    );

    // heuristic → 50/50 A/B → optional LinUCB override + SlotProposal. Never
    // leaves the row unplaced: a miss gets the last resort, a throw discards it.
    // A plan that needs the user's confirmation discards it the same way and
    // answers 409 with the plan; the dto is kept so a confirm can insert it.
    const placement = await placeOrDiscard(
      this.prisma,
      { userId: user.id, sessionIds: [created.id] },
      async () => {
        const res = await this.taskPlacement.placeOnCreate({
          user,
          task: {
            id: created.id,
            durationMinutes: created.durationMinutes,
            deadline,
          },
          now,
          infeasiblePolicy: dto.infeasiblePolicy,
          createInput: dto as unknown as Prisma.InputJsonValue,
          undoGroupId,
        });
        if (res.pendingPlan) {
          throw new PlacementNeedsConfirmationException(res.pendingPlan);
        }
        return res;
      },
    );
    return toCreateSessionResponse(
      {
        ...created,
        scheduledStartTime: placement.scheduledStartTime,
        placementReason: placement.placementReason ?? null,
        placementReasonStartAt: placement.scheduledStartTime,
      },
      { ...slotProposalFieldsOf(placement), undoGroupId },
    );
  }

  /**
   * A recurring fixed session (`DND` / `ASSIGNMENT` / `EXAM` / `LECTURE` +
   * `rrule`): one `SessionSeries` holds the pattern, one representative row
   * anchors the first occurrence, `list()` fans it out. User-pinned — no
   * placement.
   */
  private async createFixedRecurring(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
  ): Promise<CreateSessionResponse> {
    const anchor = new Date(dto.scheduledStartTime as string);
    const repStart = firstOccurrence(
      dto.rrule as string,
      anchor,
      user.timezone,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      const series = await tx.sessionSeries.create({
        data: {
          type: dto.type,
          rrule: dto.rrule as string,
          deadline: null,
          userId: user.id,
        },
      });
      return insertFixedSession(tx, {
        userId: user.id,
        type: dto.type as Exclude<SessionType, "TASK">,
        source: "USER",
        title: dto.title,
        note: dto.note,
        location: dto.location,
        durationMinutes: dto.durationMinutes,
        scheduledStartTime: repStart,
        seriesId: series.id,
        tagIds,
      });
    });

    return toCreateSessionResponse(created);
  }

  /** A one-off fixed session (`ASSIGNMENT` / `EXAM` / `LECTURE` / non-recurring
   * `DND`). User-pinned — no placement. */
  private async createFixedOneOff(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
  ): Promise<CreateSessionResponse> {
    const start = new Date(dto.scheduledStartTime as string);
    const created = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      // Shared with the DLU watchers' materializer so `source` /
      // `externalKey` / the CREATE event can't drift between the two paths.
      return insertFixedSession(tx, {
        userId: user.id,
        type: dto.type as Exclude<SessionType, "TASK">,
        source: "USER",
        title: dto.title,
        note: dto.note,
        location: dto.location,
        durationMinutes: dto.durationMinutes,
        scheduledStartTime: start,
        tagIds,
      });
    });

    return toCreateSessionResponse(created);
  }

  async list(dto: ListSessionsDto, user: User): Promise<SessionsListResponse> {
    const tz = user.timezone;
    const { startStr: displayStartStr, endStr: displayEndStr } =
      displayDayRange(dto.view, dto.date);
    const displayStart = minutesToUtc(displayStartStr, 0, tz);
    const displayEnd = minutesToUtc(displayEndStr, 1439, tz);

    const rows = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        OR: [
          { scheduledStartTime: null },
          // A day back so a plain session that started the previous evening
          // and runs past midnight into this window is still fetched —
          // filtered to actual overlap below (mirrors day-load.ts's
          // occupancy scan for the same class of bug on the placement side).
          {
            scheduledStartTime: {
              gte: new Date(displayStart.getTime() - DAY_MS),
              lte: displayEnd,
            },
          },
          // Series representatives: first-occurrence instant may be outside the
          // window; expanded below.
          { seriesId: { not: null } },
        ],
      },
      include: WITH_TAGS_AND_SERIES,
    });

    const states = await this.occurrenceStates(
      user.id,
      rows,
      new Date(displayStart.getTime() - DAY_MS),
      displayEnd,
    );

    const sessions: SharedSession[] = [];
    for (const row of rows) {
      if (row.seriesId && row.series?.rrule && row.scheduledStartTime) {
        const base = toSessionDto(row);
        for (const occ of expandRrule(
          row.series.rrule,
          row.scheduledStartTime,
          // Same day-back widening as above, so an occurrence that started
          // the previous day and crosses into this window isn't dropped.
          new Date(displayStart.getTime() - DAY_MS),
          displayEnd,
          tz,
          row.series.exdates,
        )) {
          const occEnd = occ.getTime() + row.durationMinutes * 60_000;
          if (occEnd <= displayStart.getTime()) continue; // ended before this day
          sessions.push({
            ...base,
            id: occurrenceId(row.seriesId, occ),
            scheduledStartTime: occ.toISOString(),
            ...occurrenceSkip(
              states,
              row.seriesId,
              occ,
              row.series.skippedFrom,
            ),
          });
        }
      } else {
        // A plain row's scheduledStartTime may sit in the previous day (the
        // widened query above) but its interval never reach into this
        // window — only keep it if it actually overlaps. Unscheduled rows
        // (scheduledStartTime null) always pass through untouched.
        if (
          row.scheduledStartTime &&
          row.scheduledStartTime.getTime() + row.durationMinutes * 60_000 <=
            displayStart.getTime()
        ) {
          continue;
        }
        sessions.push(toSessionDto(row));
      }
    }

    return { sessions };
  }

  /** Done or skipped occurrences of the recurring reps in `rows`, keyed by {@link occurrenceStateKey}. */
  private async occurrenceStates(
    userId: string,
    rows: {
      seriesId: string | null;
      series: { rrule: string | null } | null;
    }[],
    from: Date,
    to: Date,
  ): Promise<Map<string, OccurrenceSkip>> {
    const seriesIds = rows
      .filter((r) => r.seriesId && r.series?.rrule)
      .map((r) => r.seriesId as string);
    if (seriesIds.length === 0) return new Map();
    const found = await this.prisma.sessionOccurrenceState.findMany({
      where: {
        userId,
        seriesId: { in: seriesIds },
        occurrenceStart: { gte: from, lt: to },
      },
    });
    return new Map(
      found.map((s) => [
        occurrenceStateKey(s.seriesId, s.occurrenceStart),
        { skipped: s.skipped },
      ]),
    );
  }

  async suggestions(
    dto: ListSessionSuggestionsDto,
    user: User,
  ): Promise<SessionSuggestionsResponse> {
    const limit = dto.limit ?? 10;
    const q = dto.q?.trim();

    const where: Prisma.SessionWhereInput = {
      userId: user.id,
      deleted: false,
    };
    if (q) where.title = { contains: q, mode: "insensitive" };

    // Overfetch before deduping — a chatty multi-sitting TASK series can eat
    // up the top `limit` rows with sittings that collapse to a single
    // suggestion below, which would otherwise starve the final list. Capped
    // so a broad title match can't force an unbounded scan.
    const overfetch = Math.min(limit * 4, 200);

    const rows = await this.prisma.session.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: WITH_TAGS_AND_SERIES,
      take: overfetch,
    });

    // Dedupe by normalized title — an autocomplete list that repeats the same
    // title (e.g. a task re-created several times while testing, or every
    // sitting of a multi-session series) isn't useful; show each distinct
    // title once. Rows are already `createdAt desc`, so the first row seen
    // per key is the most-recently-created one.
    const seen = new Set<string>();
    const deduped: typeof rows = [];
    for (const row of rows) {
      const key = row.title.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
      if (deduped.length >= limit) break;
    }

    return { suggestions: deduped.map((r) => toSessionDto(r)) };
  }

  async findById(id: string, user: User): Promise<SessionDetailResponse> {
    // A recurring occurrence ref resolves to its series' representative row,
    // re-stamped with the occurrence's own id + start.
    const occ = parseOccurrenceId(id);
    if (occ) {
      const rep = await this.prisma.session.findFirst({
        where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
        orderBy: { createdAt: "asc" },
        include: WITH_TAGS_AND_SERIES,
      });
      if (!rep)
        throw new NotFoundException(`Cannot find session with id ${id}`);
      const start = new Date(occ.startISO);
      const states = await this.occurrenceStates(
        user.id,
        [rep],
        start,
        new Date(start.getTime() + 1),
      );
      return {
        ...toSessionDto(rep),
        id,
        scheduledStartTime: occ.startISO,
        ...occurrenceSkip(
          states,
          occ.seriesId,
          start,
          rep.series?.skippedFrom ?? null,
        ),
        prepSessions: await this.prepSessionsOf(user, rep.id, start),
        nextPrepOccurrenceStart: await this.nextPrepOccurrence(
          user,
          rep,
          start,
        ),
        prepTarget: null,
      };
    }

    const session = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!session)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    return {
      ...toSessionDto(session),
      prepSessions: await this.prepSessionsOf(user, session.id, null),
      nextPrepOccurrenceStart: null,
      prepTarget: await this.prepTargetOf(user, session),
    };
  }

  /** The session a prep plan prepares for; a recurring occurrence keeps its occurrence id and start. */
  private async prepTargetOf(
    user: User,
    plan: SessionRow,
  ): Promise<SharedSession | null> {
    if (!plan.prepForSessionId) return null;
    const target = await this.prisma.session.findFirst({
      where: { id: plan.prepForSessionId, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!target) return null;
    const dto = toSessionDto(target);
    const at = plan.prepForOccurrenceStart;
    if (!at || !target.seriesId) return dto;
    return {
      ...dto,
      id: occurrenceId(target.seriesId, at),
      scheduledStartTime: at.toISOString(),
    };
  }

  /** The next occurrence after `after` that is not skipped, unless it already has a prep plan. */
  private async nextPrepOccurrence(
    user: User,
    rep: SessionRow,
    after: Date,
  ): Promise<string | null> {
    const series = rep.series;
    if (!series?.rrule || !rep.scheduledStartTime) return null;
    const to = new Date(after.getTime() + NEXT_OCCURRENCE_WINDOW_DAYS * DAY_MS);
    const candidates = expandRrule(
      series.rrule,
      rep.scheduledStartTime,
      new Date(after.getTime() + 1),
      to,
      user.timezone,
      series.exdates,
    ).slice(0, NEXT_OCCURRENCE_SCAN);
    if (candidates.length === 0) return null;
    const states = await this.occurrenceStates(
      user.id,
      [rep],
      candidates[0],
      new Date(candidates[candidates.length - 1].getTime() + 1),
    );
    const next = candidates.find(
      (c) =>
        !occurrenceSkip(states, series.id, c, series.skippedFrom).skipped,
    );
    if (!next) return null;
    const taken = await this.prisma.session.findFirst({
      where: {
        userId: user.id,
        deleted: false,
        prepForSessionId: rep.id,
        prepForOccurrenceStart: next,
      },
      select: { id: true },
    });
    return taken ? null : next.toISOString();
  }

  private async prepSessionsOf(
    user: User,
    targetId: string,
    occurrenceStart: Date | null,
  ): Promise<SharedSession[]> {
    const rows = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        prepForSessionId: targetId,
        prepForOccurrenceStart: occurrenceStart,
      },
      include: WITH_TAGS_AND_SERIES,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSessionDto);
  }

  async remove(id: string, user: User): Promise<RemoveSessionResponse> {
    try {
      // A recurring occurrence ref → add the instant to the series' exdates
      // ("delete this one"); the row and other occurrences stay put.
      const occ = parseOccurrenceId(id);
      if (occ)
        return await this.series.excludeOccurrence(
          occ.seriesId,
          occ.startISO,
          user,
        );

      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.session.findFirst({
          where: { id, userId: user.id, deleted: false },
        });
        if (!existing)
          throw new NotFoundException(`Cannot find session with id ${id}`);
        assertSyncedDeletable(existing);
        // Soft-delete: an ingested item's externalKey stays unique, so the
        // materializer recognizes this row on the next re-fetch and leaves
        // it alone instead of recreating it.
        await tx.session.update({
          where: { id, userId: user.id },
          data: { deleted: true },
        });
        return { id };
      });
    } catch (error) {
      mapSessionPrismaError(error, id, "remove");
    }
  }

  /**
   * Timetable-group delete (backend-only scope for the pwa's
   * three-way delete choice on a portal-ingested `LECTURE`): soft-delete
   * `sessionId` and every later meeting sharing its
   * `(userId, scheduleStudyUnitId)` group ("this and following"). A
   * portal-ingested `LECTURE` has no `SessionSeries`/`seriesId` — one flat
   * `Session` row per meeting — so `scheduleStudyUnitId` (the portal's own
   * course-section id) is the only grouping key. 404 when the session isn't
   * the caller's, doesn't exist, or isn't groupable (no
   * `scheduleStudyUnitId` — not a portal-ingested lecture).
   */
  async removeTimetableGroupFrom(
    sessionId: string,
    user: User,
  ): Promise<RemoveTimetableGroupResponse> {
    const anchor = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
        deleted: false,
        scheduleStudyUnitId: { not: null },
      },
      select: { scheduleStudyUnitId: true, scheduledStartTime: true },
    });
    if (!anchor)
      throw new NotFoundException(
        `Cannot find groupable timetable session ${sessionId}`,
      );

    const targets = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        scheduleStudyUnitId: anchor.scheduleStudyUnitId,
        scheduledStartTime: { gte: anchor.scheduledStartTime ?? undefined },
      },
      select: { id: true },
    });
    const removedSessionIds = targets.map((t) => t.id);

    await this.prisma.session.updateMany({
      where: { id: { in: removedSessionIds }, userId: user.id },
      data: { deleted: true },
    });

    return { removedSessionIds };
  }

  /**
   * Timetable-group delete, unconditional on time ("all occurrences") —
   * soft-deletes every meeting in `sessionId`'s
   * `(userId, scheduleStudyUnitId)` group, matching {@link removeSeries}'s
   * "delete everything" semantics. Same 404 conditions as
   * {@link removeTimetableGroupFrom}.
   */
  async removeTimetableGroup(
    sessionId: string,
    user: User,
  ): Promise<RemoveTimetableGroupResponse> {
    const anchor = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
        deleted: false,
        scheduleStudyUnitId: { not: null },
      },
      select: { scheduleStudyUnitId: true },
    });
    if (!anchor)
      throw new NotFoundException(
        `Cannot find groupable timetable session ${sessionId}`,
      );

    const targets = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        deleted: false,
        scheduleStudyUnitId: anchor.scheduleStudyUnitId,
      },
      select: { id: true },
    });
    const removedSessionIds = targets.map((t) => t.id);

    await this.prisma.session.updateMany({
      where: { id: { in: removedSessionIds }, userId: user.id },
      data: { deleted: true },
    });

    return { removedSessionIds };
  }
}
