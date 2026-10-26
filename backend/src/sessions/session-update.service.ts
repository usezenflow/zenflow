import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  SESSION_WINDOW_HOURS,
  type InfeasiblePolicy,
  type SessionWindow,
  type UpdateSessionResponse,
} from "@zenflow/shared";
import { formatInTimeZone } from "date-fns-tz";
import {
  Prisma,
  type SessionEventSource,
  type User,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { wouldConflict } from "../scheduler/io/conflict-check";
import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  parseOccurrenceId,
  reanchorTimeOfDay,
} from "../scheduler/core/recurrence";
import { MAX_SCAN_DAYS } from "../scheduler/constants";
import { DAY_MS } from "../scheduler/core/slot";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SessionRow, WITH_SERIES } from "./types/session-row";
import {
  NO_SLOT_PROPOSAL,
  slotProposalFieldsOf,
  toUpdateSessionResponse,
} from "./session-mapper";
import { editEventData, moveEventData, recordUserMove } from "./session-events";
import { assertSyncedEditable } from "./synced-lock";
import { mapSessionPrismaError } from "./prisma-error";
import { SeriesService } from "./series.service";
import { assertTaskBounds, constraintOf } from "./task-bounds";

/** 400 for `PATCH { scheduledStartTime: null }` on a `TASK`. */
export const TASK_START_REQUIRED_MESSAGE =
  "Plans can't be unscheduled\nMove it to another time instead.";

/** The parsed shape of a recurring-occurrence ref ("<seriesId>::<startISO>"). */
type OccurrenceRef = NonNullable<ReturnType<typeof parseOccurrenceId>>;

/** `dto` carries an actual reschedule/resize — the only case `scope` matters. */
function isRescheduleChange(dto: UpdateSessionDto): boolean {
  return (
    dto.scheduledStartTime !== undefined || dto.durationMinutes !== undefined
  );
}

/** What one first user move (drag/resize) of a session needs to trigger the
 * delayed LinUCB reward (when applicable) and the unconditional
 * preference-matrix reinforcement (Item 3B3), surfaced out of the
 * field-diff transaction. `oldStartMs` is the start that was actually placed
 * and then rejected; `newStartMs` is the user-chosen destination. */
interface FirstMove {
  eventId: bigint;
  dragDistanceMinutes: number;
  oldStartMs: number;
  newStartMs: number;
}

/** Everything the rest of `update()` needs out of the plain-field-diff
 * transaction (recurrence lifecycle included). */
interface FieldDiffResult {
  updated: SessionRow;
  firstMove: FirstMove | null;
  newDeadline: Date | null;
  /** Undo group of the `MOVE` this PATCH wrote, or `null` when it moved nothing. */
  undoGroupId: string | null;
}

/**
 * `PATCH /sessions/:id` — a plain field diff, plus (for fixed types) the
 * whole-series recurrence lifecycle, the `MOVE` telemetry + first-move LinUCB
 * reward for a user drag/resize of a scheduled `TASK`, and — on a deadline
 * change — a single re-placement (standalone task) or series redistribution.
 * Never auto-searches otherwise; no other session is ever moved.
 *
 * Reads top-to-bottom as the sequence of things a PATCH can mean: a recurring
 * "this and following" split, a recurring occurrence re-anchor, a materialized
 * the plain field diff (+ recurrence lifecycle + MOVE telemetry), deadline
 * re-placement, then conflict pruning — each step short-circuits with its own response when
 * it applies; the rest fall through to the plain-diff response at the end.
 */
@Injectable()
export class SessionUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskPlacement: TaskPlacementService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
    private readonly series: SeriesService,
  ) {}

  async update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
    origin: SessionEventSource = dto.source ?? "ZENFLOW",
  ): Promise<UpdateSessionResponse> {
    try {
      const now = new Date();
      const occ = parseOccurrenceId(id);
      await this.guardSynced(id, occ, dto, user);

      const followingSplit = await this.handleFollowingRecurringSplit(
        id,
        occ,
        dto,
        user,
      );
      if (followingSplit) return followingSplit;

      const detached = await this.handleOccurrenceDetach(id, occ, dto, user);
      if (detached) return detached;

      id = await this.resolveOccurrenceTarget(id, occ, dto, user);
      const shiftedRepStart =
        occ && dto.scheduledStartTime ? new Date(dto.scheduledStartTime) : null;

      if (!occ) await this.guardDeadlineEdit(id, dto, user, now);

      const { updated, firstMove, newDeadline, undoGroupId } =
        await this.runFieldDiffTransaction(id, dto, user, now, origin);

      if (shiftedRepStart)
        await this.series.shiftPrepOccurrences(id, shiftedRepStart, user);

      if (firstMove) {
        await this.schedulingFeedback.onFirstMove(
          user.id,
          id,
          firstMove.eventId,
          firstMove.dragDistanceMinutes,
          {
            fromMs: firstMove.oldStartMs,
            toMs: firstMove.newStartMs,
            timezone: user.timezone,
          },
        );
        await this.schedulingFeedback.reinforcePreferenceMove(
          user.id,
          firstMove.oldStartMs,
          firstMove.newStartMs,
          user.timezone,
          firstMove.dragDistanceMinutes,
        );
      }

      const redistribution = await this.handleDeadlineRedistribution(
        newDeadline,
        updated,
        user,
        now,
        dto.infeasiblePolicy,
      );
      if (redistribution) return redistribution;

      const skippedSessionIds = await this.pruneConflictingOccurrences(
        occ,
        dto,
        updated,
        now,
        user,
      );

      return {
        ...toUpdateSessionResponse(updated),
        skippedSessionIds,
        ...(undoGroupId ? { undoGroupId } : {}),
      };
    } catch (error) {
      mapSessionPrismaError(error, id, "update");
    }
  }

  /** A synced timetable, exam or assignment keeps the sync's values (403). */
  private async guardSynced(
    id: string,
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<void> {
    const row = await this.prisma.session.findFirst({
      where: occ
        ? { seriesId: occ.seriesId, userId: user.id, deleted: false }
        : { id, userId: user.id, deleted: false },
      select: { source: true, type: true },
    });
    if (row) assertSyncedEditable(row, dto);
  }

  /**
   * Pre-flight for a TASK deadline edit, BEFORE the field-diff transaction
   * writes anything (issue #62 E): rejects `now + duration > deadline` (400),
   * and runs the same slot / repack / accept-policy check a create does (409
   * `SCHEDULE_INFEASIBLE`).
   */
  private async guardDeadlineEdit(
    id: string,
    dto: UpdateSessionDto,
    user: User,
    now: Date,
  ): Promise<void> {
    if (dto.deadline === undefined) return;
    const existing = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      select: {
        type: true,
        durationMinutes: true,
        deadline: true,
        notBefore: true,
        window: true,
      },
    });
    if (!existing || existing.type !== "TASK") return;
    const deadline = new Date(dto.deadline);
    if (existing.deadline?.getTime() === deadline.getTime()) return;
    const durationMinutes = dto.durationMinutes ?? existing.durationMinutes;

    await this.taskPlacement.preflightTask({
      user,
      taskId: id,
      durationMinutes,
      deadline,
      now,
      policy: dto.infeasiblePolicy,
      constraint: constraintOf(existing),
    });
  }

  /**
   * A recurring occurrence ref ("<seriesId>::<startISO>") with `scope:
   * "following"` and an actual reschedule — a genuine "this and every
   * occurrence after it" split, which has no representative-row-reanchor
   * equivalent and needs its own series. `null` when this PATCH isn't that.
   */
  private async handleFollowingRecurringSplit(
    id: string,
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse | null> {
    if (!(occ && dto.scope === "following" && isRescheduleChange(dto))) {
      return null;
    }
    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    if (!rep || !rep.scheduledStartTime)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    const { session, skippedSessionIds } =
      await this.series.updateRecurringFollowing(
        occ.seriesId,
        occ.startISO,
        {
          scheduledStartTime:
            dto.scheduledStartTime ?? rep.scheduledStartTime.toISOString(),
          durationMinutes: dto.durationMinutes ?? rep.durationMinutes,
        },
        dto.skipConflicting ?? false,
        user,
      );
    return {
      ...session,
      ...NO_SLOT_PROPOSAL,
      skippedSessionIds: skippedSessionIds.length
        ? skippedSessionIds
        : undefined,
    };
  }

  /**
   * A recurring occurrence ref with `scope: "occurrence"` and a reschedule
   * moves just that occurrence: the series keeps its time and the occurrence
   * reappears as a one-off. A PATCH that also changes the rrule is a series
   * change and falls through. `null` otherwise.
   */
  private async handleOccurrenceDetach(
    id: string,
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse | null> {
    if (
      !(
        occ &&
        dto.scope === "occurrence" &&
        isRescheduleChange(dto) &&
        dto.rrule === undefined
      )
    ) {
      return null;
    }
    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    if (!rep || !rep.scheduledStartTime)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    const session = await this.series.detachOccurrence(
      occ.seriesId,
      occ.startISO,
      {
        scheduledStartTime:
          dto.scheduledStartTime ?? rep.scheduledStartTime.toISOString(),
        durationMinutes: dto.durationMinutes ?? rep.durationMinutes,
      },
      user,
    );
    return { ...session, ...NO_SLOT_PROPOSAL };
  }

  /**
   * A recurring occurrence ref (not otherwise handled above) edits its series
   * through the representative row: metadata applies series-wide; a
   * `scheduledStartTime` change shifts only the *time of day* (the
   * first-occurrence date is kept so the rrule anchor can't drop earlier
   * occurrences — mutates `dto.scheduledStartTime` in place). Returns the id
   * to operate on for the rest of `update()` — the representative row's real
   * id, or `id` unchanged when this PATCH isn't an occurrence ref.
   */
  private async resolveOccurrenceTarget(
    id: string,
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<string> {
    if (!occ) return id;

    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      select: { id: true, scheduledStartTime: true },
    });
    if (!rep) throw new NotFoundException(`Cannot find session with id ${id}`);

    if (dto.scheduledStartTime && rep.scheduledStartTime) {
      dto.scheduledStartTime = reanchorTimeOfDay(
        rep.scheduledStartTime,
        new Date(dto.scheduledStartTime),
        user.timezone,
      ).toISOString();
    }
    return rep.id;
  }

  /**
   * A TASK's `notBefore` / `window` after this PATCH, or null when untouched.
   * A manual move outside a bound is the user's override, so that bound is
   * dropped; bounds that no start could satisfy are rejected.
   */
  private taskBoundsAfter(
    dto: UpdateSessionDto,
    existing: SessionRow,
    timezone: string,
  ): { notBefore: Date | null; window: SessionWindow | null } | null {
    if (existing.type !== "TASK") return null;
    const given = dto.notBefore !== undefined || dto.window !== undefined;
    const moved = dto.scheduledStartTime
      ? new Date(dto.scheduledStartTime)
      : null;
    let notBefore =
      dto.notBefore !== undefined
        ? dto.notBefore
          ? new Date(dto.notBefore)
          : null
        : existing.notBefore;
    let window =
      dto.window !== undefined
        ? dto.window
        : (existing.window as SessionWindow | null);
    if (!notBefore && !window) return given ? { notBefore, window } : null;

    if (moved && notBefore && moved < notBefore) notBefore = null;
    if (moved && window) {
      const hour = Number(formatInTimeZone(moved, timezone, "H"));
      const [from, to] = SESSION_WINDOW_HOURS[window];
      if (hour < from || hour >= to) window = null;
    }
    const deadline =
      dto.deadline !== undefined ? new Date(dto.deadline) : existing.deadline;
    if (deadline)
      assertTaskBounds({
        notBefore,
        window,
        durationMinutes: dto.durationMinutes ?? existing.durationMinutes,
        deadline,
      });
    return { notBefore, window };
  }

  /** The plain field diff + (for fixed types) the whole-series recurrence
   * lifecycle + `MOVE` telemetry, all in one transaction. */
  private runFieldDiffTransaction(
    id: string,
    dto: UpdateSessionDto,
    user: User,
    now: Date,
    origin: SessionEventSource,
  ): Promise<FieldDiffResult> {
    return this.prisma.$transaction(async (tx): Promise<FieldDiffResult> => {
      const existing = await tx.session.findFirst({
        where: { id, userId: user.id, deleted: false },
        include: WITH_SERIES,
      });
      if (!existing)
        throw new NotFoundException(`Cannot find session with id ${id}`);

      const data: Prisma.SessionUpdateInput = {};
      let newDeadline: Date | null = null;
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.note !== undefined) data.note = dto.note;
      if (dto.location !== undefined) data.location = dto.location;
      const reminderChanged =
        dto.reminderMinutes !== undefined &&
        dto.reminderMinutes !== existing.reminderMinutes;
      if (dto.reminderMinutes !== undefined)
        data.reminderMinutes = dto.reminderMinutes;
      if (dto.attendees !== undefined) data.attendees = dto.attendees;

      if (dto.durationMinutes !== undefined)
        data.durationMinutes = dto.durationMinutes;

      if (dto.prepForOccurrenceStart !== undefined) {
        if (!existing.prepForSessionId)
          throw new BadRequestException("Only a prep plan has a target");
        data.prepForOccurrenceStart = new Date(dto.prepForOccurrenceStart);
      }

      if (dto.deadline !== undefined) {
        const candidate = new Date(dto.deadline);
        if (
          !existing.deadline ||
          candidate.getTime() !== existing.deadline.getTime()
        ) {
          newDeadline = candidate;
        }
        data.deadline = candidate;
      }

      let nextStart: Date | null | undefined;
      const bounds = this.taskBoundsAfter(dto, existing, user.timezone);
      if (bounds) {
        data.notBefore = bounds.notBefore;
        data.window = bounds.window;
      }
      if (dto.scheduledStartTime === null && existing.type === "TASK") {
        // A live TASK always has a start: it is moved, never unscheduled.
        throw new BadRequestException(TASK_START_REQUIRED_MESSAGE);
      }
      if (dto.scheduledStartTime !== undefined) {
        nextStart = dto.scheduledStartTime
          ? new Date(dto.scheduledStartTime)
          : null;
        data.scheduledStartTime = nextStart;
      }
      const startChanged =
        nextStart !== undefined &&
        (nextStart?.getTime() ?? null) !==
          (existing.scheduledStartTime?.getTime() ?? null);

      const orphanedSeriesId = await this.applyRecurrenceLifecycle(
        tx,
        dto,
        existing,
        data,
        user,
        now,
      );

      if (startChanged) {
        // Any manual reschedule — not just a scheduler-tracked TASK move —
        // must be remembered here, for every session type, so the ingestion
        // watchers' anti-clobber check (materializer.service.ts) warns
        // instead of silently reverting a hand-moved EXAM/LECTURE/ASSIGNMENT
        // back to its upstream (LMS/portal) position on their next sync.
        data.lastMovedAt = now;
      }

      const move = this.buildMoveEventData(existing, nextStart, startChanged);
      let firstMove: FirstMove | null = null;
      let undoGroupId: string | null = null;
      if (move) {
        undoGroupId = randomUUID();
        const event = await tx.sessionEvent.create({
          data: {
            ...moveEventData({
              sessionId: id,
              userId: user.id,
              oldStart: existing.scheduledStartTime as Date,
              oldDurationMinutes: existing.durationMinutes,
              newStart: move.movedTo,
              newDurationMinutes:
                dto.durationMinutes ?? existing.durationMinutes,
              dragDistanceMinutes: move.dragDistanceMinutes,
              source: origin,
            }),
            groupId: undoGroupId,
          },
          select: { id: true },
        });
        recordUserMove(move.dragDistanceMinutes);
        // "First move" = the session had never been moved before this call.
        if (existing.lastMovedAt == null) {
          firstMove = {
            eventId: event.id,
            dragDistanceMinutes: move.dragDistanceMinutes,
            oldStartMs: (existing.scheduledStartTime as Date).getTime(),
            newStartMs: move.movedTo.getTime(),
          };
        }
      }

      if (reminderChanged) {
        await tx.sessionEvent.create({
          data: editEventData({
            sessionId: id,
            userId: user.id,
            oldReminderMinutes: existing.reminderMinutes,
            newReminderMinutes: dto.reminderMinutes ?? null,
            source: origin,
          }),
        });
      }

      const row = await tx.session.update({
        where: { id },
        data,
        include: WITH_SERIES,
      });
      if (orphanedSeriesId) {
        await tx.sessionSeries.delete({ where: { id: orphanedSeriesId } });
      }

      return { updated: row, newDeadline, firstMove, undoGroupId };
    });
  }

  /**
   * Recurrence edit — whole-series. Four cases, all fixed types:
   *  · already a series, new rrule  → update the pattern, wipe exdates,
   *    re-anchor the representative to the first occurrence;
   *  · already a series, rrule null → collapse back to a one-off (the caller
   *    drops the now-empty series row after the main `session.update`);
   *  · one-off, new rrule           → spin up a series and adopt this row as
   *    its representative;
   *  · one-off, rrule null          → nothing to do.
   * Mutates `data` in place; returns the series id to delete afterward, or
   * `null`.
   */
  private async applyRecurrenceLifecycle(
    tx: Prisma.TransactionClient,
    dto: UpdateSessionDto,
    existing: SessionRow,
    data: Prisma.SessionUpdateInput,
    user: User,
    now: Date,
  ): Promise<string | null> {
    if (dto.rrule === undefined || existing.type === "TASK") return null;

    const anchorStart = () =>
      (data.scheduledStartTime as Date | undefined) ??
      existing.scheduledStartTime ??
      now;

    if (existing.seriesId && dto.rrule) {
      await tx.sessionSeries.update({
        where: { id: existing.seriesId },
        data: { rrule: dto.rrule, exdates: [] },
      });
      data.scheduledStartTime = firstOccurrence(
        dto.rrule,
        anchorStart(),
        user.timezone,
      );
      return null;
    }
    if (existing.seriesId && !dto.rrule) {
      data.series = { disconnect: true };
      return existing.seriesId;
    }
    if (!existing.seriesId && dto.rrule) {
      const series = await tx.sessionSeries.create({
        data: {
          type: existing.type,
          rrule: dto.rrule,
          userId: user.id,
        },
      });
      data.series = { connect: { id: series.id } };
      data.scheduledStartTime = firstOccurrence(
        dto.rrule,
        anchorStart(),
        user.timezone,
      );
    }
    return null;
  }

  /** `MOVE` signal for a user drag (or start-side resize) of a scheduled
   * `TASK`; `null` otherwise. An end-side resize leaves the start unchanged, so
   * it is not a move. */
  private buildMoveEventData(
    existing: SessionRow,
    nextStart: Date | null | undefined,
    startChanged: boolean,
  ): { movedTo: Date; dragDistanceMinutes: number } | null {
    const isUserTask = existing.type === "TASK" && existing.source === "USER";
    if (!isUserTask || !existing.scheduledStartTime || !startChanged) {
      return null;
    }
    const movedTo = nextStart ?? existing.scheduledStartTime;
    const dragDistanceMinutes = Math.round(
      (movedTo.getTime() - existing.scheduledStartTime.getTime()) / 60_000,
    );
    return { movedTo, dragDistanceMinutes };
  }

  /**
   * A deadline change re-places just the affected TASK into its new best empty
   * slot. No other session is ever moved. `null` when this PATCH isn't a
   * deadline change on a `TASK`.
   */
  private async handleDeadlineRedistribution(
    newDeadline: Date | null,
    updated: SessionRow,
    user: User,
    now: Date,
    infeasiblePolicy?: InfeasiblePolicy,
  ): Promise<UpdateSessionResponse | null> {
    if (!newDeadline || updated.type !== "TASK") return null;

    const placement = await this.taskPlacement.placeOnDeadlineChange({
      user,
      task: {
        id: updated.id,
        durationMinutes: updated.durationMinutes,
        deadline: newDeadline,
        prevStartMs: updated.scheduledStartTime?.getTime(),
        constraint: constraintOf(updated),
      },
      now,
      infeasiblePolicy,
    });
    return {
      ...toUpdateSessionResponse(
        {
          ...updated,
          scheduledStartTime:
            placement.scheduledStartTime ?? updated.scheduledStartTime,
          placementReason: placement.placementReason ?? null,
          placementReasonStartAt: placement.scheduledStartTime,
        },
        slotProposalFieldsOf(placement),
      ),
      ...(placement.pendingPlan
        ? { placementPlan: placement.pendingPlan }
        : {}),
    };
  }

  /**
   * "All occurrences" (scope "series", or omitted — today's default
   * whole-series reanchor) with `skipConflicting`: the reanchor already moved
   * every occurrence's time-of-day at once (it's virtual — one representative
   * row), so prune out whichever upcoming landings now collide instead of
   * leaving them overlapping. Returns the pruned ids, or `undefined` when
   * this PATCH doesn't call for pruning.
   */
  private async pruneConflictingOccurrences(
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    updated: SessionRow,
    now: Date,
    user: User,
  ): Promise<string[] | undefined> {
    if (
      !(
        occ &&
        dto.skipConflicting &&
        (dto.scope === "series" || dto.scope === undefined) &&
        updated.seriesId &&
        updated.series?.rrule &&
        updated.scheduledStartTime
      )
    ) {
      return undefined;
    }

    const seriesId = updated.seriesId;
    const scanEnd = new Date(now.getTime() + MAX_SCAN_DAYS * DAY_MS);
    const occStarts = expandRrule(
      updated.series.rrule,
      updated.scheduledStartTime,
      now,
      scanEnd,
      user.timezone,
      updated.series.exdates,
    );
    const skipped: string[] = [];
    for (const occStart of occStarts) {
      const conflict = await wouldConflict(this.prisma, {
        userId: user.id,
        timezone: user.timezone,
        start: occStart,
        durationMinutes: updated.durationMinutes,
        excludeSessionIds: [updated.id],
        excludeSeriesId: seriesId,
      });
      if (conflict) {
        await this.series.excludeOccurrence(
          seriesId,
          occStart.toISOString(),
          user,
        );
        skipped.push(occurrenceId(seriesId, occStart));
      }
    }
    return skipped.length ? skipped : undefined;
  }
}
