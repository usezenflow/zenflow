import {
  Prisma,
  SessionEventType,
  type SessionEventSource,
  type SessionType,
} from "../../generated/prisma";
import type { SessionRow } from "./types/session-row";
import { toSessionSnapshot } from "./session-mapper";
import { SESSION_MOVE_REWARD } from "../scheduler/constants";
import {
  schedulerMoveDragMinutes,
  schedulerSessionEvents,
} from "../observability/metrics";

/**
 * `SessionEvent` payload builders (`docs/adr/0002-scheduling-simplification.md`).
 * Pure — they return the `data` object; the caller does the `tx.sessionEvent.create`.
 */

/** Count `count` written `SessionEvent` rows of `type`. Call right after the insert. */
export function recordSessionEvent(type: SessionEventType, count = 1): void {
  schedulerSessionEvents.add(count, { type });
}

/** A `CREATE` event was written. */
export function recordCreateEvent(): void {
  recordSessionEvent(SessionEventType.CREATE);
}

/** A user `MOVE` event: counts it and records its absolute drag distance. */
export function recordUserMove(dragDistanceMinutes: number): void {
  recordSessionEvent(SessionEventType.MOVE);
  schedulerMoveDragMinutes.record(Math.abs(dragDistanceMinutes));
}

/** A `CREATE` event for a freshly-inserted row. `seriesId` groups a `sessionCount`
 * batch so `DELETE /sessions/series/:id` can revert it (issue #32). */
export function createEventData(
  row: SessionRow,
  userId: string,
  seriesId?: string,
): Prisma.SessionEventUncheckedCreateInput {
  return {
    sessionId: row.id,
    userId,
    eventType: SessionEventType.CREATE,
    ...(seriesId ? { seriesId } : {}),
    newSnapshot: toSessionSnapshot(row),
  };
}

/** The `{ scheduledStartTime, durationMinutes, type }` a change-log row records. */
export function snapshotOf(row: {
  scheduledStartTime: Date | null;
  durationMinutes: number;
  type: SessionType;
}): Prisma.InputJsonValue {
  return {
    scheduledStartTime: row.scheduledStartTime?.toISOString() ?? null,
    durationMinutes: row.durationMinutes,
    type: row.type,
  };
}

/** A session removed before it started, from the app or the phone. Carries no reward. */
export function deleteEventData(args: {
  sessionId: string;
  userId: string;
  snapshot: Prisma.InputJsonValue;
  source: SessionEventSource;
}): Prisma.SessionEventUncheckedCreateInput {
  return {
    sessionId: args.sessionId,
    userId: args.userId,
    eventType: SessionEventType.DELETE,
    oldSnapshot: args.snapshot,
    newSnapshot: { deleted: true },
    source: args.source,
  };
}

/** A change to a session's reminder. Carries no reward. */
export function editEventData(args: {
  sessionId: string;
  userId: string;
  oldReminderMinutes: number | null;
  newReminderMinutes: number | null;
  source: SessionEventSource;
}): Prisma.SessionEventUncheckedCreateInput {
  return {
    sessionId: args.sessionId,
    userId: args.userId,
    eventType: SessionEventType.EDIT,
    oldSnapshot: { reminderMinutes: args.oldReminderMinutes },
    newSnapshot: { reminderMinutes: args.newReminderMinutes },
    source: args.source,
  };
}

/** A `MOVE` event for a user drag (or start-side resize) of a scheduled TASK. */
export function moveEventData(args: {
  sessionId: string;
  userId: string;
  oldStart: Date;
  oldDurationMinutes: number;
  newStart: Date;
  newDurationMinutes: number;
  dragDistanceMinutes: number;
  source?: SessionEventSource;
}): Prisma.SessionEventUncheckedCreateInput {
  return {
    sessionId: args.sessionId,
    userId: args.userId,
    eventType: SessionEventType.MOVE,
    source: args.source ?? "ZENFLOW",
    oldSnapshot: {
      scheduledStartTime: args.oldStart.toISOString(),
      durationMinutes: args.oldDurationMinutes,
    },
    newSnapshot: {
      scheduledStartTime: args.newStart.toISOString(),
      durationMinutes: args.newDurationMinutes,
    },
    dragDistanceMinutes: args.dragDistanceMinutes,
    rewardScore: SESSION_MOVE_REWARD,
  };
}
