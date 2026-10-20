import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { SessionSeries, User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { SessionSkipService } from "./session-skip.service";
import type { SessionRow } from "./types/session-row";

const user = { id: "user-1", timezone: "UTC" } as User;
const now = new Date("2026-10-14T10:00:00.000Z");

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s-1",
    title: "Study",
    note: null,
    location: null,
    locationLat: null,
    locationLng: null,
    originLocation: null,
    originLat: null,
    originLng: null,
    commuteMinutes: null,
    commuteAuto: false,
    durationMinutes: 60,
    deadline: null,
    type: "LECTURE",
    source: "USER",
    conflict: false,
    deleted: false,
    scheduledStartTime: new Date("2026-10-14T08:00:00.000Z"),
    userId: user.id,
    lastMovedAt: null,
    submittedAt: null,
    prepForSessionId: null,
    prepForOccurrenceStart: null,
    syncConfirmedAt: null,
    syncMissedAt: null,
    skipped: false,
    placementReason: null,
    placementReasonStartAt: null,
    seriesId: null,
    sessionIndex: null,
    sessionTotal: null,
    externalKey: null,
    scheduleStudyUnitId: null,
    lmsCourseId: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    tags: [],
    series: null,
    reminders: [],
    ...overrides,
  };
}

function fakePrisma(found: SessionRow | null) {
  const prisma = {
    session: {
      findFirst: jest.fn().mockResolvedValue(found),
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...found, ...data }),
      ),
    },
    sessionEvent: { create: jest.fn(), deleteMany: jest.fn() },
    sessionOccurrenceState: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sessionSeries: {
      findFirst: jest.fn().mockResolvedValue({
        skippedFrom: null,
        sessions: [{ scheduledStartTime: new Date("2026-10-01T07:00:00.000Z") }],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return prisma;
}

/** The first argument of a mock's first call. */
const firstArg = (fn: jest.Mock): unknown => (fn.mock.calls[0] as unknown[])[0];

async function build(prisma: unknown) {
  const module = await Test.createTestingModule({
    providers: [
      SessionSkipService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return module.get(SessionSkipService);
}

describe("SessionSkipService", () => {
  it("skips a calendar session without writing a SessionEvent", async () => {
    const prisma = fakePrisma(row());
    const service = await build(prisma);

    const res = await service.set("s-1", true, user);

    expect(firstArg(prisma.session.update)).toMatchObject({
      where: { id: "s-1" },
      data: { skipped: true },
    });
    expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
    expect(res.session).toMatchObject({ id: "s-1", skipped: true });
  });

  it("undoes a skip", async () => {
    const prisma = fakePrisma(row({ skipped: true }));
    const service = await build(prisma);

    const res = await service.set("s-1", false, user);

    expect(firstArg(prisma.session.update)).toMatchObject({
      data: { skipped: false },
    });
    expect(res.session).toMatchObject({ skipped: false });
  });

  it("rejects a TASK with 400 and writes nothing", async () => {
    const prisma = fakePrisma(row({ type: "TASK", deadline: new Date() }));
    const service = await build(prisma);

    await expect(service.set("s-1", true, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it("404s a missing row", async () => {
    const service = await build(fakePrisma(null));

    await expect(service.set("nope", true, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects the representative row id of a recurring series", async () => {
    const series: SessionSeries = {
      id: "series-1",
      createdAt: now,
      type: "LECTURE",
      deadline: null,
      rrule: "FREQ=DAILY",
      exdates: [],
      skippedFrom: null,
      userId: user.id,
    };
    const service = await build(fakePrisma(row({ series })));

    await expect(service.set("s-1", true, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe("recurring occurrence", () => {
    const series: SessionSeries = {
      id: "series-1",
      createdAt: now,
      type: "LECTURE",
      deadline: null,
      rrule: "FREQ=DAILY",
      exdates: ["2026-10-13T07:00:00.000Z"],
      skippedFrom: null,
      userId: user.id,
    };
    const rep = row({
      id: "rep-1",
      seriesId: "series-1",
      series,
      scheduledStartTime: new Date("2026-10-01T07:00:00.000Z"),
    });
    const occId = "series-1::2026-10-14T07:00:00.000Z";

    it("records the skipped state per occurrence and keeps the occurrence id", async () => {
      const prisma = fakePrisma(rep);
      const service = await build(prisma);

      const res = await service.set(occId, true, user);

      expect(firstArg(prisma.sessionOccurrenceState.upsert)).toMatchObject({
        create: {
          seriesId: "series-1",
          occurrenceStart: new Date("2026-10-14T07:00:00.000Z"),
          skipped: true,
        },
      });
      expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
      expect(res.session).toMatchObject({
        id: occId,
        scheduledStartTime: "2026-10-14T07:00:00.000Z",
        skipped: true,
      });
    });

    it("undo removes the state row", async () => {
      const prisma = fakePrisma(rep);
      const service = await build(prisma);

      const res = await service.set(occId, false, user);

      expect(prisma.sessionOccurrenceState.deleteMany).toHaveBeenCalledWith({
        where: {
          seriesId: "series-1",
          occurrenceStart: new Date("2026-10-14T07:00:00.000Z"),
        },
      });
      expect(res.session).toMatchObject({ skipped: false });
    });

    it("404s an occurrence the rule never produces", async () => {
      const service = await build(fakePrisma(rep));

      await expect(
        service.set("series-1::2026-10-13T07:00:00.000Z", true, user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects a TASK series", async () => {
      const task = row({
        id: "rep-1",
        seriesId: "series-1",
        series: { ...series, type: "TASK" },
        type: "TASK",
        deadline: new Date(),
        scheduledStartTime: new Date("2026-10-01T07:00:00.000Z"),
      });
      const prisma = fakePrisma(task);
      const service = await build(prisma);

      await expect(service.set(occId, true, user)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.sessionOccurrenceState.upsert).not.toHaveBeenCalled();
    });

    describe("skip scope", () => {
      it("following exempts the series from that occurrence", async () => {
        const prisma = fakePrisma(rep);
        const service = await build(prisma);

        await service.set(occId, true, user, "following");

        expect(firstArg(prisma.sessionSeries.update)).toMatchObject({
          where: { id: "series-1" },
          data: { skippedFrom: new Date("2026-10-14T07:00:00.000Z") },
        });
      });

      it("all exempts the series from its first occurrence", async () => {
        const prisma = fakePrisma(rep);
        const service = await build(prisma);

        await service.set(occId, true, user, "all");

        expect(firstArg(prisma.sessionSeries.update)).toMatchObject({
          data: { skippedFrom: new Date("2026-10-01T07:00:00.000Z") },
        });
      });

      it("undo clears the exemption", async () => {
        const prisma = fakePrisma(rep);
        const service = await build(prisma);

        await service.set(occId, false, user, "following");

        expect(firstArg(prisma.sessionSeries.update)).toMatchObject({
          data: { skippedFrom: null },
        });
      });

      it("rejects a scope on a plain session", async () => {
        const service = await build(fakePrisma(row()));

        await expect(
          service.set("s-1", true, user, "following"),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });
});

describe("SessionSkipService.skipTimetableGroup", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 5, day, 8, 0, 0));

  /** A stateful double: `findFirst`/`findMany` read `rows`, `update` writes it back. */
  function timetablePrisma(rows: SessionRow[]) {
    const find = (where: {
      id?: string;
      scheduleStudyUnitId?: { not: null };
    }) =>
      rows.find(
        (r) =>
          (where.id === undefined || r.id === where.id) &&
          !r.deleted &&
          r.userId === user.id &&
          (!where.scheduleStudyUnitId || r.scheduleStudyUnitId !== null),
      ) ?? null;
    return {
      session: {
        findFirst: jest.fn(({ where }: { where: Parameters<typeof find>[0] }) =>
          Promise.resolve(find(where)),
        ),
        findMany: jest.fn(
          ({
            where,
          }: {
            where: {
              scheduleStudyUnitId: string;
              scheduledStartTime: { gte?: Date; not?: null };
            };
          }) =>
            Promise.resolve(
              rows
                .filter(
                  (r) =>
                    !r.deleted &&
                    r.userId === user.id &&
                    r.scheduleStudyUnitId === where.scheduleStudyUnitId &&
                    r.scheduledStartTime !== null &&
                    (!where.scheduledStartTime.gte ||
                      r.scheduledStartTime.getTime() >=
                        where.scheduledStartTime.gte.getTime()),
                )
                .sort(
                  (a, b) =>
                    (a.scheduledStartTime as Date).getTime() -
                    (b.scheduledStartTime as Date).getTime(),
                )
                .map((r) => ({ id: r.id })),
            ),
        ),
        update: jest.fn(
          ({ where, data }: { where: { id: string }; data: object }) => {
            const r = rows.find((x) => x.id === where.id) as SessionRow;
            Object.assign(r, data);
            return Promise.resolve({ ...r });
          },
        ),
      },
      sessionEvent: { create: jest.fn(), deleteMany: jest.fn() },
    };
  }

  const section = [
    row({ id: "m-1", scheduleStudyUnitId: "SEC-A", scheduledStartTime: at(1) }),
    row({ id: "m-2", scheduleStudyUnitId: "SEC-A", scheduledStartTime: at(8) }),
    row({ id: "m-3", scheduleStudyUnitId: "SEC-A", scheduledStartTime: at(15) }),
    row({ id: "other-1", scheduleStudyUnitId: "SEC-B", scheduledStartTime: at(8) }),
  ];

  it("skips every meeting in the group, regardless of time, without events", async () => {
    const rows = section.map((r) => ({ ...r }));
    const prisma = timetablePrisma(rows);
    const service = await build(prisma);

    const res = await service.skipTimetableGroup("m-2", false, user);

    expect(res.skippedSessionIds.sort()).toEqual(["m-1", "m-2", "m-3"]);
    expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
    expect(rows.find((r) => r.id === "other-1")?.skipped).toBe(false);
    expect(
      rows
        .filter((r) => r.skipped)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["m-1", "m-2", "m-3"]);
  });

  it("from: skips the anchor and later meetings only", async () => {
    const rows = section.map((r) => ({ ...r }));
    const service = await build(timetablePrisma(rows));

    const res = await service.skipTimetableGroup("m-2", true, user);

    expect(res.skippedSessionIds.sort()).toEqual(["m-2", "m-3"]);
    expect(rows.find((r) => r.id === "m-1")?.skipped).toBe(false);
    expect(rows.find((r) => r.id === "m-3")?.skipped).toBe(true);
  });

  it("404s a session that is not a grouped timetable meeting, writing nothing", async () => {
    const rows = [row({ id: "t-1", scheduleStudyUnitId: null })];
    const prisma = timetablePrisma(rows);
    const service = await build(prisma);

    await expect(
      service.skipTimetableGroup("t-1", false, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.skipTimetableGroup("t-1", true, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});
