import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { SessionUpdateService } from "./session-update.service";
import { PrismaService } from "../prisma/prisma.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { SeriesService } from "./series.service";
import { occurrenceId } from "../scheduler/core/recurrence";
import { DAY_MS } from "../scheduler/core/slot";
import type { Session, SessionSeries, User } from "../../generated/prisma";
import type { UpdateSessionDto } from "./dto/update-session.dto";

/**
 * Focused coverage for `SessionUpdateService`'s `scope`/`skipConflicting`
 * branching (the drag/resize confirmation-sheet feature). `sessions.service.spec.ts`
 * already covers the plain per-row PATCH / MOVE telemetry / deadline-redistribute
 * paths end to end through the full `SessionsService` facade — these tests isolate
 * just the new routing, with `SeriesService` stubbed so each branch's delegation
 * (or lack thereof) can be asserted directly.
 */

type SessionRow = Session & { series: SessionSeries | null };

const user: User = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  timezone: "UTC",
  lang: "EN_US",
  preferenceMatrix: [],
  preferenceMatrixDecayedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as User;

function session(overrides: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    title: "Session",
    note: null,
    location: null,
    examFormat: null,
    examCredits: null,
    examRetake: null,
    reminderMinutes: null,
    durationMinutes: 60,
    deadline: null,
    notBefore: null,
    window: null,
    series: null,
    type: "LECTURE",
    source: "USER",
    conflict: false,
    scheduledStartTime: null,
    lastMovedAt: null,
    submittedAt: null,
    prepForSessionId: null,
    prepForOccurrenceStart: null,
    placementReason: null,
    placementReasonStartAt: null,
    deleted: false,
    userId: user.id,
    seriesId: null,
    externalKey: null,
    scheduleStudyUnitId: null,
    lmsCourseId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeSeries() {
  return {
    updateSiblingTimeOfDay: jest.fn(),
    updateRecurringFollowing: jest.fn(),
    redistribute: jest.fn(),
    excludeOccurrence: jest.fn().mockResolvedValue({ id: "noop" }),
    detachOccurrence: jest.fn(),
    promoteToSeries: jest.fn(),
    resizeSessionCount: jest.fn(),
  };
}

function fakeTaskPlacement() {
  return {
    placeOnDeadlineChange: jest
      .fn()
      .mockResolvedValue({ scheduledStartTime: null, appliedPolicy: "NONE" }),
  };
}

function fakeSchedulingFeedback() {
  return {
    onFirstMove: jest.fn().mockResolvedValue(undefined),
    reinforcePreferenceMatrix: jest.fn().mockResolvedValue(undefined),
    reinforcePreferenceMove: jest.fn().mockResolvedValue(undefined),
  };
}

async function makeService(
  prisma: never,
  series: ReturnType<typeof fakeSeries> = fakeSeries(),
  schedulingFeedback: ReturnType<
    typeof fakeSchedulingFeedback
  > = fakeSchedulingFeedback(),
): Promise<SessionUpdateService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionUpdateService,
      {
        provide: PrismaService,
        // The synced-row guard reads the row first; most cases only mock the transaction.
        useValue: {
          session: { findFirst: jest.fn().mockResolvedValue(null) },
          ...(prisma as object),
        },
      },
      { provide: TaskPlacementService, useValue: fakeTaskPlacement() },
      { provide: SchedulingFeedbackService, useValue: schedulingFeedback },
      { provide: SeriesService, useValue: series },
    ],
  }).compile();
  return module.get<SessionUpdateService>(SessionUpdateService);
}

describe("SessionUpdateService — no scope (regression: byte-for-byte unchanged)", () => {
  it("a title-only diff never touches SeriesService's new scope methods", async () => {
    const existing = session({ id: "session-1", title: "Old" });
    const updated = session({ id: "session-1", title: "New" });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = await makeService(prisma as never, series);

    const result = await service.update("session-1", { title: "New" }, user);

    expect(series.updateSiblingTimeOfDay).not.toHaveBeenCalled();
    expect(series.updateRecurringFollowing).not.toHaveBeenCalled();
    expect(result.title).toBe("New");
    expect(result.skippedSessionIds).toBeUndefined();
  });

  it("a reschedule with scope omitted on a TASK-series sitting patches only that row (today's default)", async () => {
    const existing = session({
      id: "sit-2",
      type: "TASK",
      seriesId: "task-series-1",
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const updated = {
      ...existing,
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    };
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        }),
    };
    const series = fakeSeries();
    const service = await makeService(prisma as never, series);

    await service.update(
      "sit-2",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(series.updateSiblingTimeOfDay).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sit-2" } }),
    );
  });
});

describe("SessionUpdateService — preference-matrix reinforcement (Item 3B3)", () => {
  it("a first drag/resize of a user TASK reinforces the preference matrix: old (rejected) hour down, new (chosen) hour up, graded by distance", async () => {
    const oldStart = new Date("2026-06-11T08:00:00.000Z");
    const existing = session({
      id: "task-1",
      type: "TASK",
      source: "USER",
      lastMovedAt: null,
      scheduledStartTime: oldStart,
    });
    const updated = {
      ...existing,
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    };
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        }),
    };
    const series = fakeSeries();
    const schedulingFeedback = fakeSchedulingFeedback();
    const service = await makeService(
      prisma as never,
      series,
      schedulingFeedback,
    );

    await service.update(
      "task-1",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(schedulingFeedback.onFirstMove).toHaveBeenCalledWith(
      user.id,
      "task-1",
      1n,
      60,
      expect.anything(),
    );
    expect(schedulingFeedback.reinforcePreferenceMove).toHaveBeenCalledWith(
      user.id,
      oldStart.getTime(),
      new Date("2026-06-11T09:00:00.000Z").getTime(),
      user.timezone,
      60,
    );
  });

  it("a SECOND move of an already-moved TASK does not reinforce the matrix (only the first move counts)", async () => {
    const existing = session({
      id: "task-1",
      type: "TASK",
      source: "USER",
      lastMovedAt: new Date("2026-06-10T00:00:00.000Z"),
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const updated = {
      ...existing,
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    };
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        }),
    };
    const schedulingFeedback = fakeSchedulingFeedback();
    const service = await makeService(
      prisma as never,
      fakeSeries(),
      schedulingFeedback,
    );

    await service.update(
      "task-1",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(schedulingFeedback.onFirstMove).not.toHaveBeenCalled();
    expect(schedulingFeedback.reinforcePreferenceMove).not.toHaveBeenCalled();
  });

  it("an end-side resize (duration only, start unchanged) is not a move: no MOVE event, no first-move, no reinforcement", async () => {
    const existing = session({
      id: "task-1",
      type: "TASK",
      source: "USER",
      lastMovedAt: null,
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
      durationMinutes: 60,
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest
      .fn()
      .mockResolvedValue({ ...existing, durationMinutes: 90 });
    const eventCreate = jest.fn();
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: eventCreate },
        }),
    };
    const schedulingFeedback = fakeSchedulingFeedback();
    const service = await makeService(
      prisma as never,
      fakeSeries(),
      schedulingFeedback,
    );

    await service.update("task-1", { durationMinutes: 90 }, user);

    expect(eventCreate).not.toHaveBeenCalled();
    expect(schedulingFeedback.onFirstMove).not.toHaveBeenCalled();
    expect(schedulingFeedback.reinforcePreferenceMove).not.toHaveBeenCalled();
    const [args] = update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.lastMovedAt).toBeUndefined();
  });

  it("manually rescheduling a fixed-type session (ASSIGNMENT/EXAM/LECTURE/DND) stamps lastMovedAt, even though it never raises a MOVE event", async () => {
    const existing = session({
      id: "assignment-1",
      type: "ASSIGNMENT",
      source: "LMS",
      lastMovedAt: null,
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue({
      ...existing,
      scheduledStartTime: new Date("2026-06-12T10:00:00.000Z"),
    });
    const eventCreate = jest.fn();
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: eventCreate },
        }),
    };
    const service = await makeService(prisma as never, fakeSeries());

    await service.update(
      "assignment-1",
      { scheduledStartTime: "2026-06-12T10:00:00.000Z" },
      user,
    );

    expect(eventCreate).not.toHaveBeenCalled();
    const [args] = update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.lastMovedAt).toBeInstanceOf(Date);
  });

  it("a start-side resize (start and duration both change) counts as the first move", async () => {
    const oldStart = new Date("2026-06-11T08:00:00.000Z");
    const newStart = new Date("2026-06-11T07:00:00.000Z");
    const existing = session({
      id: "task-1",
      type: "TASK",
      source: "USER",
      lastMovedAt: null,
      scheduledStartTime: oldStart,
      durationMinutes: 60,
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue({
      ...existing,
      scheduledStartTime: newStart,
      durationMinutes: 120,
    });
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        }),
    };
    const schedulingFeedback = fakeSchedulingFeedback();
    const service = await makeService(
      prisma as never,
      fakeSeries(),
      schedulingFeedback,
    );

    await service.update(
      "task-1",
      { scheduledStartTime: newStart.toISOString(), durationMinutes: 120 },
      user,
    );

    expect(schedulingFeedback.onFirstMove).toHaveBeenCalledWith(
      user.id,
      "task-1",
      1n,
      -60,
      expect.anything(),
    );
    expect(schedulingFeedback.reinforcePreferenceMove).toHaveBeenCalledWith(
      user.id,
      oldStart.getTime(),
      newStart.getTime(),
      user.timezone,
      -60,
    );
  });

  it("a title-only diff (no move) never reinforces the matrix", async () => {
    const existing = session({ id: "session-1", title: "Old", type: "TASK" });
    const updated = session({ id: "session-1", title: "New", type: "TASK" });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const schedulingFeedback = fakeSchedulingFeedback();
    const service = await makeService(
      prisma as never,
      fakeSeries(),
      schedulingFeedback,
    );

    await service.update("session-1", { title: "New" }, user);

    expect(schedulingFeedback.reinforcePreferenceMove).not.toHaveBeenCalled();
  });
});

describe("SessionUpdateService — recurring occurrence, scope 'following'", () => {
  it("delegates to updateRecurringFollowing, short-circuiting the representative-row reanchor", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
      durationMinutes: 90,
    });
    const transaction = jest.fn();
    const prisma = { session: { findFirst }, $transaction: transaction };
    const series = fakeSeries();
    series.updateRecurringFollowing.mockResolvedValue({
      session: { id: "new-rep-1", title: "Lecture" },
      skippedSessionIds: [],
    });
    const service = await makeService(prisma as never, series);

    const occId = occurrenceId(
      "lecture-series-1",
      new Date("2026-06-08T09:00:00.000Z"),
    );
    const dto: UpdateSessionDto = {
      scheduledStartTime: "2026-06-08T10:00:00.000Z",
      durationMinutes: 60,
      scope: "following",
      skipConflicting: true,
    };
    const result = await service.update(occId, dto, user);

    expect(transaction).not.toHaveBeenCalled();
    expect(series.updateRecurringFollowing).toHaveBeenCalledWith(
      "lecture-series-1",
      "2026-06-08T09:00:00.000Z",
      { scheduledStartTime: "2026-06-08T10:00:00.000Z", durationMinutes: 60 },
      true,
      user,
    );
    expect(result.id).toBe("new-rep-1");
    expect(result.skippedSessionIds).toBeUndefined();
  });

  it("surfaces skippedSessionIds returned by updateRecurringFollowing", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
      durationMinutes: 90,
    });
    const prisma = { session: { findFirst }, $transaction: jest.fn() };
    const series = fakeSeries();
    series.updateRecurringFollowing.mockResolvedValue({
      session: { id: "new-rep-1" },
      skippedSessionIds: ["new-rep-1::2026-06-15T10:00:00.000Z"],
    });
    const service = await makeService(prisma as never, series);

    const occId = occurrenceId(
      "lecture-series-1",
      new Date("2026-06-08T09:00:00.000Z"),
    );
    const result = await service.update(
      occId,
      {
        scheduledStartTime: "2026-06-08T10:00:00.000Z",
        durationMinutes: 60,
        scope: "following",
        skipConflicting: true,
      },
      user,
    );

    expect(result.skippedSessionIds).toEqual([
      "new-rep-1::2026-06-15T10:00:00.000Z",
    ]);
  });
});

describe("SessionUpdateService — recurring occurrence, scope 'series' (or omitted) + skipConflicting", () => {
  it("prunes a future occurrence whose new landing would conflict into the series' exdates", async () => {
    // Anchor tomorrow at 09:00 UTC, daily — guarantees occurrences fall inside
    // the [now, now+MAX_SCAN_DAYS] window regardless of the exact instant the
    // service reads `now` at.
    const anchor = new Date(Date.now() + DAY_MS);
    anchor.setUTCHours(9, 0, 0, 0);
    const rrule = "FREQ=DAILY;COUNT=3";
    const seriesRow: SessionSeries = {
      id: "lecture-series-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "LECTURE",
      rrule,
      exdates: [],
      userId: user.id,
    };
    const existing = session({
      id: "rep-1",
      type: "LECTURE",
      seriesId: "lecture-series-1",
      series: seriesRow,
      scheduledStartTime: anchor,
      durationMinutes: 90,
    });
    // The PATCH itself doesn't change the time (title/duration untouched) —
    // this test targets the pruning pass in isolation.
    const updated = existing;

    const txFindFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);

    // The second day's landing collides with another session; the 1st/3rd
    // days are free.
    const collidingDay = new Date(anchor.getTime() + DAY_MS);
    const sessionFindMany = jest.fn(
      (args: {
        where: { scheduledStartTime?: { gte?: Date; lte?: Date } };
      }) => {
        const gte = args.where.scheduledStartTime?.gte?.getTime() ?? 0;
        const lte = args.where.scheduledStartTime?.lte?.getTime() ?? Infinity;
        const t = collidingDay.getTime();
        if (t >= gte && t <= lte) {
          return Promise.resolve([
            {
              scheduledStartTime: collidingDay,
              durationMinutes: 30,
              type: "TASK",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    const seriesFindMany = jest.fn().mockResolvedValue([]);
    const repFindFirst = jest
      .fn()
      .mockResolvedValue({ id: "rep-1", scheduledStartTime: anchor });

    const prisma = {
      session: { findFirst: repFindFirst, findMany: sessionFindMany },
      sessionSeries: { findMany: seriesFindMany },
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst: txFindFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = await makeService(prisma as never, series);

    const occId = occurrenceId("lecture-series-1", anchor);
    const result = await service.update(occId, { skipConflicting: true }, user);

    expect(series.excludeOccurrence).toHaveBeenCalledTimes(1);
    expect(series.excludeOccurrence).toHaveBeenCalledWith(
      "lecture-series-1",
      collidingDay.toISOString(),
      user,
    );
    expect(result.skippedSessionIds).toEqual([
      occurrenceId("lecture-series-1", collidingDay),
    ]);
  });

  it("does not prune anything when skipConflicting is left false (today's default)", async () => {
    const anchor = new Date(Date.now() + DAY_MS);
    anchor.setUTCHours(9, 0, 0, 0);
    const seriesRow: SessionSeries = {
      id: "lecture-series-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "LECTURE",
      rrule: "FREQ=DAILY;COUNT=3",
      exdates: [],
      userId: user.id,
    };
    const existing = session({
      id: "rep-1",
      type: "LECTURE",
      seriesId: "lecture-series-1",
      series: seriesRow,
      scheduledStartTime: anchor,
      durationMinutes: 90,
    });
    const txFindFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(existing);
    const sessionFindMany = jest.fn();
    const repFindFirst = jest
      .fn()
      .mockResolvedValue({ id: "rep-1", scheduledStartTime: anchor });
    const prisma = {
      session: { findFirst: repFindFirst, findMany: sessionFindMany },
      sessionSeries: { findMany: jest.fn() },
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst: txFindFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = await makeService(prisma as never, series);

    const occId = occurrenceId("lecture-series-1", anchor);
    const result = await service.update(occId, { title: "New" }, user);

    expect(sessionFindMany).not.toHaveBeenCalled();
    expect(series.excludeOccurrence).not.toHaveBeenCalled();
    expect(result.skippedSessionIds).toBeUndefined();
  });
});

describe("SessionUpdateService — recurring occurrence, scope 'occurrence'", () => {
  it("detaches just that occurrence at the new time, leaving the series' time untouched", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
      durationMinutes: 90,
    });
    const transaction = jest.fn();
    const prisma = { session: { findFirst }, $transaction: transaction };
    const series = fakeSeries();
    series.detachOccurrence = jest.fn().mockResolvedValue({ id: "one-off-1" });
    const service = await makeService(prisma as never, series);

    const occId = occurrenceId(
      "lecture-series-1",
      new Date("2026-06-08T09:00:00.000Z"),
    );
    const result = await service.update(
      occId,
      {
        scheduledStartTime: "2026-06-08T10:00:00.000Z",
        scope: "occurrence",
      },
      user,
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(series.updateRecurringFollowing).not.toHaveBeenCalled();
    expect(series.detachOccurrence).toHaveBeenCalledWith(
      "lecture-series-1",
      "2026-06-08T09:00:00.000Z",
      { scheduledStartTime: "2026-06-08T10:00:00.000Z", durationMinutes: 90 },
      user,
    );
    expect(result.id).toBe("one-off-1");
  });

  it("an rrule change with scope 'occurrence' is a series change and does not detach", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: "rep-1",
      scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
      durationMinutes: 90,
    });
    const series = fakeSeries();
    const service = await makeService(
      { session: { findFirst }, $transaction: jest.fn() } as never,
      series,
    );

    await service
      .update(
        occurrenceId("lecture-series-1", new Date("2026-06-08T09:00:00.000Z")),
        {
          scheduledStartTime: "2026-06-08T10:00:00.000Z",
          rrule: null,
          scope: "occurrence",
        },
        user,
      )
      .catch(() => undefined);

    expect(series.detachOccurrence).not.toHaveBeenCalled();
  });
});

describe("SessionUpdateService — synced rows", () => {
  const syncedRow = (over: object = {}) => ({
    source: "PORTAL",
    type: "LECTURE",
    ...over,
  });
  const build = async (row: object | null) =>
    makeService({
      session: { findFirst: jest.fn().mockResolvedValue(row) },
    } as never);

  it.each([
    { title: "New" },
    { scheduledStartTime: "2026-10-20T09:00:00.000Z" },
    { durationMinutes: 60 },
    { location: "B201" },
  ])("refuses to edit %o on a synced lecture", async (dto) => {
    const service = await build(syncedRow());
    await expect(service.update("s-1", dto, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("refuses to move a synced exam", async () => {
    const service = await build(syncedRow({ source: "LMS", type: "EXAM" }));
    await expect(
      service.update(
        "s-1",
        { scheduledStartTime: "2026-10-20T09:00:00.000Z" },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
