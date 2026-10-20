import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { SessionSeries, User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  nextCheckOffState,
  SessionCheckOffService,
} from "./session-check-off.service";
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
    deadline: new Date("2026-10-20T00:00:00.000Z"),
    type: "TASK",
    source: "USER",
    conflict: false,
    deleted: false,
    scheduledStartTime: new Date("2026-10-14T08:00:00.000Z"),
    userId: user.id,
    lastMovedAt: null,
    submittedAt: null,
    prepForSessionId: null,
    prepForOccurrenceStart: null,
    retainedAt: null,
    syncConfirmedAt: null,
    syncMissedAt: null,
    completedAt: null,
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

function fakePrisma(found: SessionRow | null, occurrenceState: unknown = null) {
  const tx = {
    session: {
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...found, ...data }),
      ),
    },
    sessionEvent: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sessionOccurrenceState: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    tx,
    prisma: {
      session: { findFirst: jest.fn().mockResolvedValue(found) },
      sessionOccurrenceState: {
        findUnique: jest.fn().mockResolvedValue(occurrenceState),
      },
      sessionSeries: {
        findFirst: jest.fn().mockResolvedValue({
          skippedFrom: null,
          sessions: [
            { scheduledStartTime: new Date("2026-10-01T07:00:00.000Z") },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
}

/** The first argument of a mock's first call. */
const firstArg = (fn: jest.Mock): unknown => (fn.mock.calls[0] as unknown[])[0];

async function build(prisma: unknown) {
  const module = await Test.createTestingModule({
    providers: [
      SessionCheckOffService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return module.get(SessionCheckOffService);
}

describe("nextCheckOffState", () => {
  const done = { completedAt: now, skipped: false };
  const skipped = { completedAt: null, skipped: true };
  const later = new Date(now.getTime() + 1000);

  it("complete clears skip and keeps the first completion time", () => {
    expect(nextCheckOffState(skipped, "complete", true, now)).toEqual(done);
    expect(nextCheckOffState(done, "complete", true, later)).toEqual(done);
  });

  it("skip clears completion", () => {
    expect(nextCheckOffState(done, "skip", true, now)).toEqual(skipped);
  });

  it("undo clears only its own state", () => {
    expect(nextCheckOffState(done, "complete", false, now)).toEqual({
      completedAt: null,
      skipped: false,
    });
    expect(nextCheckOffState(done, "skip", false, now)).toEqual(done);
  });
});

describe("SessionCheckOffService", () => {
  it("completes a row, writes a COMPLETE event", async () => {
    const { prisma, tx } = fakePrisma(row());
    const service = await build(prisma);

    const res = await service.set("s-1", "complete", true, user, now);

    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completedAt: now, skipped: false } }),
    );
    expect(firstArg(tx.sessionEvent.create)).toMatchObject({
      data: { eventType: "COMPLETE", sessionId: "s-1" },
    });
    expect(res.session.completedAt).toBe(now.toISOString());
  });

  it("undoing a completion deletes its event and writes none", async () => {
    const { prisma, tx } = fakePrisma(row({ completedAt: now }));
    const service = await build(prisma);

    const res = await service.set("s-1", "complete", false, user, now);

    expect(tx.sessionEvent.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: "s-1", userId: user.id, eventType: "COMPLETE" },
    });
    expect(tx.sessionEvent.create).not.toHaveBeenCalled();
    expect(res.session.completedAt).toBeNull();
  });

  it("skipping a completed row swaps COMPLETE for SKIP", async () => {
    const { prisma, tx } = fakePrisma(row({ completedAt: now }));
    const service = await build(prisma);

    await service.set("s-1", "skip", true, user, now);

    expect(firstArg(tx.sessionEvent.deleteMany)).toMatchObject({
      where: { eventType: "COMPLETE" },
    });
    expect(firstArg(tx.sessionEvent.create)).toMatchObject({
      data: { eventType: "SKIP" },
    });
  });

  it("is idempotent: completing twice writes one event", async () => {
    const { prisma, tx } = fakePrisma(row({ completedAt: now }));
    const service = await build(prisma);

    await service.set("s-1", "complete", true, user, now);

    expect(tx.sessionEvent.create).not.toHaveBeenCalled();
  });

  it("404s a missing row", async () => {
    const { prisma } = fakePrisma(null);
    const service = await build(prisma);

    await expect(
      service.set("nope", "complete", true, user, now),
    ).rejects.toBeInstanceOf(NotFoundException);
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
      type: "LECTURE",
      deadline: null,
      seriesId: "series-1",
      series,
      scheduledStartTime: new Date("2026-10-01T07:00:00.000Z"),
    });
    const occId = "series-1::2026-10-14T07:00:00.000Z";

    it("records per-occurrence state and keeps the occurrence id", async () => {
      const { prisma, tx } = fakePrisma(rep);
      const service = await build(prisma);

      const res = await service.set(occId, "complete", true, user, now);

      expect(firstArg(tx.sessionOccurrenceState.upsert)).toMatchObject({
        create: {
          seriesId: "series-1",
          occurrenceStart: new Date("2026-10-14T07:00:00.000Z"),
          completedAt: now,
        },
      });
      expect(firstArg(tx.sessionEvent.create)).toMatchObject({
        data: {
          sessionId: "rep-1",
          eventType: "COMPLETE",
          newSnapshot: { scheduledStartTime: "2026-10-14T07:00:00.000Z" },
        },
      });
      expect(res.session).toMatchObject({
        id: occId,
        scheduledStartTime: "2026-10-14T07:00:00.000Z",
        completedAt: now.toISOString(),
        skipped: false,
      });
    });

    it("undo removes the state row and that occurrence's event", async () => {
      const { prisma, tx } = fakePrisma(rep, {
        completedAt: now,
        skipped: false,
      });
      const service = await build(prisma);

      await service.set(occId, "complete", false, user, now);

      expect(tx.sessionOccurrenceState.deleteMany).toHaveBeenCalled();
      expect(firstArg(tx.sessionEvent.deleteMany)).toMatchObject({
        where: {
          sessionId: "rep-1",
          eventType: "COMPLETE",
          newSnapshot: {
            path: ["scheduledStartTime"],
            equals: "2026-10-14T07:00:00.000Z",
          },
        },
      });
    });

    it("404s an occurrence the rule never produces or the user deleted", async () => {
      const { prisma } = fakePrisma(rep);
      const service = await build(prisma);

      await expect(
        service.set("series-1::2026-10-14T08:00:00.000Z", "skip", true, user),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.set("series-1::2026-10-13T07:00:00.000Z", "skip", true, user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe("skip scope", () => {
      const skippedFromOf = (prisma: {
        sessionSeries: { update: jest.Mock };
      }) => (firstArg(prisma.sessionSeries.update) as { data: object }).data;

      it("following exempts the series from that occurrence", async () => {
        const { prisma } = fakePrisma(rep);
        const service = await build(prisma);

        const res = await service.set(
          occId,
          "skip",
          true,
          user,
          now,
          "following",
        );

        expect(skippedFromOf(prisma)).toEqual({
          skippedFrom: new Date("2026-10-14T07:00:00.000Z"),
        });
        expect(res.session.skipped).toBe(true);
      });

      it("all exempts the series from its first occurrence", async () => {
        const { prisma } = fakePrisma(rep);
        const service = await build(prisma);

        await service.set(occId, "skip", true, user, now, "all");

        expect(skippedFromOf(prisma)).toEqual({
          skippedFrom: new Date("2026-10-01T07:00:00.000Z"),
        });
      });

      it("keeps an earlier exemption when a later one is added", async () => {
        const { prisma } = fakePrisma(rep);
        prisma.sessionSeries.findFirst.mockResolvedValue({
          skippedFrom: new Date("2026-10-05T07:00:00.000Z"),
          sessions: [
            { scheduledStartTime: new Date("2026-10-01T07:00:00.000Z") },
          ],
        });
        const service = await build(prisma);

        await service.set(occId, "skip", true, user, now, "following");

        expect(skippedFromOf(prisma)).toEqual({
          skippedFrom: new Date("2026-10-05T07:00:00.000Z"),
        });
      });

      it("undo clears the exemption", async () => {
        const { prisma } = fakePrisma(rep);
        const service = await build(prisma);

        await service.set(occId, "skip", false, user, now, "all");

        expect(skippedFromOf(prisma)).toEqual({ skippedFrom: null });
      });

      it("rejects a scope on a plain session or on complete", async () => {
        const { prisma } = fakePrisma(row());
        const service = await build(prisma);

        await expect(
          service.set("s-1", "skip", true, user, now, "all"),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.set(occId, "complete", true, user, now, "all"),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it("rejects the representative row id", async () => {
      const { prisma } = fakePrisma(rep);
      const service = await build(prisma);

      await expect(
        service.set("rep-1", "complete", true, user, now),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe("SessionCheckOffService.skipTimetableGroup", () => {
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
    const tx = {
      session: {
        update: jest.fn(
          ({ where, data }: { where: { id: string }; data: object }) => {
            const r = rows.find((x) => x.id === where.id) as SessionRow;
            Object.assign(r, data);
            return Promise.resolve({ ...r });
          },
        ),
      },
      sessionEvent: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
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
      },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    return { prisma, tx };
  }

  const section = [
    row({ id: "m-1", scheduleStudyUnitId: "SEC-A", scheduledStartTime: at(1) }),
    row({ id: "m-2", scheduleStudyUnitId: "SEC-A", scheduledStartTime: at(8) }),
    row({
      id: "m-3",
      scheduleStudyUnitId: "SEC-A",
      scheduledStartTime: at(15),
    }),
    row({
      id: "other-1",
      scheduleStudyUnitId: "SEC-B",
      scheduledStartTime: at(8),
    }),
  ];

  it("skips every meeting in the group, regardless of time, each with a SKIP event", async () => {
    const rows = section.map((r) => ({ ...r }));
    const { prisma, tx } = timetablePrisma(rows);
    const service = await build(prisma);

    const res = await service.skipTimetableGroup("m-2", false, user, now);

    expect(res.skippedSessionIds.sort()).toEqual(["m-1", "m-2", "m-3"]);
    expect(tx.sessionEvent.create).toHaveBeenCalledTimes(3);
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
    const { prisma } = timetablePrisma(rows);
    const service = await build(prisma);

    const res = await service.skipTimetableGroup("m-2", true, user, now);

    expect(res.skippedSessionIds.sort()).toEqual(["m-2", "m-3"]);
    expect(rows.find((r) => r.id === "m-1")?.skipped).toBe(false);
    expect(rows.find((r) => r.id === "m-3")?.skipped).toBe(true);
  });

  it("404s a session that is not a grouped timetable meeting, writing nothing", async () => {
    const rows = [row({ id: "t-1", scheduleStudyUnitId: null })];
    const { prisma, tx } = timetablePrisma(rows);
    const service = await build(prisma);

    await expect(
      service.skipTimetableGroup("t-1", false, user, now),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.skipTimetableGroup("t-1", true, user, now),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.session.update).not.toHaveBeenCalled();
  });
});
