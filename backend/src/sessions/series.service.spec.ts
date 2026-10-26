/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { SeriesService } from "./series.service";
import { occurrenceId } from "../scheduler/core/recurrence";
import type { Session, SessionSeries, User } from "../../generated/prisma";

/**
 * Focused coverage for `SeriesService`'s two drag/resize-confirmation scope
 * methods — `updateSiblingTimeOfDay` (materialized `TASK` series sittings) and
 * `updateRecurringFollowing` (recurring fixed series "this and following").
 * `SessionUpdateService`'s own routing into these is covered by
 * `session-update.service.spec.ts`; these tests exercise the methods directly
 * against a hand-rolled Prisma double (`TaskPlacementService`
 * aren't touched by either method, so they're stubbed out).
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
    type: "TASK",
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

async function makeSeriesService(
  prisma: unknown,
  placement: unknown = {
    canPlaceSeries: jest.fn(),
    placeSeriesOnCreate: jest.fn(),
    redistributeSeries: jest.fn(),
  },
): Promise<SeriesService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SeriesService,
      { provide: PrismaService, useValue: prisma },
      { provide: TaskPlacementService, useValue: placement },
    ],
  }).compile();
  return module.get<SeriesService>(SeriesService);
}

describe("SeriesService.updateRecurringFollowing", () => {
  const oldSeriesId = "lecture-series-1";
  const newSeriesId = "lecture-series-2";
  const oldRep = session({
    id: "rep-old-1",
    type: "LECTURE",
    seriesId: oldSeriesId,
    title: "Gym",
    note: "bring a towel",
    scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
    durationMinutes: 60,
  });

  function buildPrisma(opts: {
    rrule: string;
    conflicting?: { start: Date; durationMinutes: number };
  }) {
    const seriesFindFirst = jest.fn(
      (args: { where: { id: string }; include?: { sessions?: unknown } }) => {
        if (args.where.id === oldSeriesId) {
          return Promise.resolve({
            id: oldSeriesId,
            rrule: opts.rrule,
            exdates: [],
            userId: user.id,
            sessions: [oldRep],
          });
        }
        if (args.where.id === newSeriesId) {
          return Promise.resolve({
            id: newSeriesId,
            rrule: opts.rrule,
            exdates: [],
            userId: user.id,
          });
        }
        return Promise.resolve(null);
      },
    );
    const seriesUpdate = jest.fn().mockResolvedValue({});
    const seriesCreate = jest
      .fn()
      .mockResolvedValue({ id: newSeriesId, type: "LECTURE" });
    let createdSession: SessionRow | null = null;
    const sessionCreate = jest.fn(
      (args: {
        data: {
          type: string;
          source: string;
          title: string;
          note: string | null;
          durationMinutes: number;
          scheduledStartTime: Date;
          seriesId: string;
        };
      }) => {
        createdSession = session({
          id: "rep-new-1",
          type: args.data.type as "LECTURE",
          source: args.data.source as "USER",
          title: args.data.title,
          note: args.data.note,
          durationMinutes: args.data.durationMinutes,
          scheduledStartTime: args.data.scheduledStartTime,
          seriesId: args.data.seriesId,
        });
        return Promise.resolve(createdSession);
      },
    );
    const eventCreate = jest.fn().mockResolvedValue({});

    const conflictSessionFindMany = jest.fn(
      (args: {
        where: { scheduledStartTime?: { gte?: Date; lte?: Date } };
      }) => {
        if (!opts.conflicting) return Promise.resolve([]);
        const gte = args.where.scheduledStartTime?.gte?.getTime() ?? 0;
        const lte = args.where.scheduledStartTime?.lte?.getTime() ?? Infinity;
        const t = opts.conflicting.start.getTime();
        if (t >= gte && t <= lte) {
          return Promise.resolve([
            {
              scheduledStartTime: opts.conflicting.start,
              durationMinutes: opts.conflicting.durationMinutes,
              type: "TASK",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const prisma: Record<string, unknown> = {
      sessionSeries: {
        findFirst: seriesFindFirst,
        update: seriesUpdate,
        create: seriesCreate,
        findMany: jest.fn().mockResolvedValue([]),
      },
      session: { create: sessionCreate, findMany: conflictSessionFindMany },
      sessionEvent: { create: eventCreate },
    };
    prisma.$transaction = (fn: (t: unknown) => unknown) => fn(prisma);

    return {
      prisma,
      seriesFindFirst,
      seriesUpdate,
      seriesCreate,
      sessionCreate,
      eventCreate,
      getCreatedSession: () => createdSession,
    };
  }

  it("truncates the old series and creates a new one anchored at the new date/time, carrying title/note/type forward", async () => {
    const { prisma, seriesUpdate, seriesCreate, sessionCreate, eventCreate } =
      buildPrisma({ rrule: "FREQ=DAILY" });
    const service = await makeSeriesService(prisma);

    const result = await service.updateRecurringFollowing(
      oldSeriesId,
      "2026-06-10T09:00:00.000Z",
      { scheduledStartTime: "2026-06-15T14:00:00.000Z", durationMinutes: 90 },
      false,
      user,
    );

    // The old series was truncated (UNTIL pulled back).
    expect(seriesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: oldSeriesId } }),
    );
    // A brand-new series + representative row was created.
    expect(seriesCreate).toHaveBeenCalledWith({
      data: {
        type: "LECTURE",
        rrule: "FREQ=DAILY",
        userId: user.id,
      },
    });
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "LECTURE",
          title: "Gym",
          note: "bring a towel",
          durationMinutes: 90,
          scheduledStartTime: new Date("2026-06-15T14:00:00.000Z"),
          seriesId: "lecture-series-2",
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(result.session.id).toBe("rep-new-1");
    expect(result.session.scheduledStartTime).toBe("2026-06-15T14:00:00.000Z");
    expect(result.skippedSessionIds).toEqual([]);
  });

  it("skipConflicting prunes a colliding future occurrence into the new series' exdates", async () => {
    const conflicting = {
      start: new Date("2026-06-16T14:15:00.000Z"),
      durationMinutes: 30,
    };
    const { prisma, seriesUpdate } = buildPrisma({
      rrule: "FREQ=DAILY;COUNT=3",
      conflicting,
    });
    const service = await makeSeriesService(prisma);

    const result = await service.updateRecurringFollowing(
      oldSeriesId,
      "2026-06-10T09:00:00.000Z",
      { scheduledStartTime: "2026-06-15T14:00:00.000Z", durationMinutes: 90 },
      true,
      user,
    );

    // The colliding day (2026-06-16, 2nd of the 3 COUNT occurrences) was
    // pushed onto the NEW series' exdates.
    expect(seriesUpdate).toHaveBeenCalledWith({
      where: { id: "lecture-series-2" },
      data: { exdates: { push: "2026-06-16T14:00:00.000Z" } },
    });
    expect(result.skippedSessionIds).toEqual([
      occurrenceId("lecture-series-2", new Date("2026-06-16T14:00:00.000Z")),
    ]);
  });

  it("throws NotFoundException for a series the user does not own / that isn't recurring", async () => {
    const prisma = {
      sessionSeries: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const service = await makeSeriesService(prisma);

    await expect(
      service.updateRecurringFollowing(
        "nope",
        "2026-06-10T09:00:00.000Z",
        { scheduledStartTime: "2026-06-15T14:00:00.000Z", durationMinutes: 90 },
        false,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SeriesService prep plan links", () => {
  const seriesId = "lecture-series-1";
  const rep = session({
    id: "rep-1",
    type: "LECTURE",
    seriesId,
    scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
  });

  function build(prepRows: unknown[] = []) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      sessionSeries: {
        findFirst: jest.fn().mockResolvedValue({
          id: seriesId,
          rrule: "FREQ=DAILY",
          exdates: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      session: {
        findFirst: jest.fn().mockResolvedValue(rep),
        findMany: jest.fn().mockResolvedValue(prepRows),
        create: jest.fn().mockResolvedValue(session({ id: "one-off-1" })),
        updateMany,
        update,
      },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: undefined as unknown,
    };
    prisma.$transaction = (fn: (t: unknown) => unknown) => fn(prisma);
    return { prisma, updateMany, update };
  }

  it("moves an occurrence's prep plan onto the one-off row it becomes", async () => {
    const { prisma, updateMany } = build();
    const service = await makeSeriesService(prisma);

    await service.detachOccurrence(
      seriesId,
      "2026-06-10T09:00:00.000Z",
      { scheduledStartTime: "2026-06-10T14:00:00.000Z", durationMinutes: 60 },
      user,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        deleted: false,
        prepForSessionId: "rep-1",
        prepForOccurrenceStart: new Date("2026-06-10T09:00:00.000Z"),
      },
      data: { prepForSessionId: "one-off-1", prepForOccurrenceStart: null },
    });
  });

  it("shifts every linked occurrence start on a series time-of-day change", async () => {
    const { prisma, update } = build([
      {
        id: "prep-1",
        prepForOccurrenceStart: new Date("2026-06-10T09:00:00.000Z"),
      },
    ]);
    const service = await makeSeriesService(prisma);

    await service.shiftPrepOccurrences(
      "rep-1",
      new Date("2026-06-01T10:00:00.000Z"),
      user,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "prep-1" },
      data: { prepForOccurrenceStart: new Date("2026-06-10T10:00:00.000Z") },
    });
  });
});
