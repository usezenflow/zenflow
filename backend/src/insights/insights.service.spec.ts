import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InsightsService } from "./insights.service";

const NOW = new Date("2026-10-23T03:00:00.000Z");
const USER = { id: "user-1", timezone: "Asia/Saigon" };

type WhereArgs = { where: Record<string, unknown>; select?: unknown };

function isRawSql(strings: TemplateStringsArray, needle: string): boolean {
  return strings.some((s) => s.includes(needle));
}

function makePrisma() {
  return {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray): Promise<unknown[]> =>
        Promise.resolve(
          isRawSql(strings, "AT TIME ZONE")
            ? [
                { weekday: 0, hour: 9, done: 2 },
                { weekday: 6, hour: 23, done: 1 },
              ]
            : [{ count: 2 }],
        ),
    ),
    session: {
      aggregate: jest.fn(
        (
          args: WhereArgs,
        ): Promise<{ _sum: { durationMinutes: number | null } }> =>
          Promise.resolve({
            _sum: { durationMinutes: args.where.events ? 120 : 300 },
          }),
      ),
      count: jest.fn(() => Promise.resolve(3)),
      findMany: jest.fn((args: WhereArgs) =>
        Promise.resolve(
          args.where.type && typeof args.where.type === "object"
            ? PARENTS
            : PREPS,
        ),
      ),
    },
  };
}

const PARENTS = [
  {
    id: "exam-1",
    title: "Calculus",
    type: "EXAM",
    scheduledStartTime: new Date("2026-11-02T02:00:00.000Z"),
  },
  {
    id: "assign-1",
    title: "Essay",
    type: "ASSIGNMENT",
    scheduledStartTime: new Date("2026-11-10T10:00:00.000Z"),
  },
  {
    id: "assign-2",
    title: "Lab",
    type: "ASSIGNMENT",
    scheduledStartTime: new Date("2026-10-30T10:00:00.000Z"),
  },
];

const PREPS = [
  {
    prepForSessionId: "exam-1",
    scheduledStartTime: new Date("2026-10-25T01:00:00.000Z"),
    durationMinutes: 120,
  },
  {
    prepForSessionId: "exam-1",
    scheduledStartTime: new Date("2026-10-29T00:00:00.000Z"),
    durationMinutes: 60,
  },
  // Starts after the exam, so it does not count toward the buffer.
  {
    prepForSessionId: "exam-1",
    scheduledStartTime: new Date("2026-11-03T00:00:00.000Z"),
    durationMinutes: 60,
  },
  // Starts before the essay is due but runs past it: buffer clamps to 0.
  {
    prepForSessionId: "assign-1",
    scheduledStartTime: new Date("2026-11-10T09:30:00.000Z"),
    durationMinutes: 120,
  },
];

async function makeService(prisma: ReturnType<typeof makePrisma>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [InsightsService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return module.get(InsightsService);
}

describe("InsightsService.summarize", () => {
  it("returns the resolved window in the user's timezone", async () => {
    const service = await makeService(makePrisma());

    const res = await service.summarize(USER, {}, NOW);

    expect(res.window).toEqual({ from: "2026-10-17", to: "2026-10-23" });
  });

  it("bounds the aggregates to local midnight of from and to + 1", async () => {
    const prisma = makePrisma();
    const service = await makeService(prisma);

    await service.summarize(
      USER,
      { from: "2026-10-17", to: "2026-10-23" },
      NOW,
    );

    const focusValues = prisma.$queryRaw.mock.calls[0].slice(1);
    expect(focusValues).toEqual(
      expect.arrayContaining([
        new Date("2026-10-16T17:00:00.000Z"),
        new Date("2026-10-23T17:00:00.000Z"),
      ]),
    );
    expect(prisma.session.count).toHaveBeenCalledWith({
      where: {
        userId: USER.id,
        type: "TASK",
        deleted: false,
        skipped: true,
        scheduledStartTime: {
          gte: new Date("2026-10-16T17:00:00.000Z"),
          lt: new Date("2026-10-23T17:00:00.000Z"),
        },
      },
    });
  });

  it("returns a full 7x24 focus grid with zeros where no DONE fell", async () => {
    const service = await makeService(makePrisma());

    const { focus } = await service.summarize(USER, {}, NOW);

    expect(focus).toHaveLength(168);
    expect(focus[0]).toEqual({ weekday: 0, hour: 0, done: 0 });
    expect(focus[9]).toEqual({ weekday: 0, hour: 9, done: 2 });
    expect(focus[167]).toEqual({ weekday: 6, hour: 23, done: 1 });
    expect(focus.reduce((n, c) => n + c.done, 0)).toBe(3);
  });

  it("sums planned and done TASK minutes, skip count and on-time count", async () => {
    const prisma = makePrisma();
    const service = await makeService(prisma);

    const { recap } = await service.summarize(USER, {}, NOW);

    expect(recap).toEqual({
      plannedMinutes: 300,
      doneMinutes: 120,
      notThisTimeCount: 3,
      onTimeCount: 2,
    });
    const plannedWhere = prisma.session.aggregate.mock.calls[0][0].where;
    expect(plannedWhere).toMatchObject({
      userId: USER.id,
      type: "TASK",
      deleted: false,
      skipped: false,
    });
    expect(prisma.session.aggregate.mock.calls[1][0].where.events).toEqual({
      some: { eventType: "DONE" },
    });
  });

  it("returns zero recap minutes when nothing was placed", async () => {
    const prisma = makePrisma();
    prisma.session.aggregate.mockResolvedValue({
      _sum: { durationMinutes: null },
    });
    prisma.session.count.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValue([{ count: 0 }]);
    const service = await makeService(prisma);

    const { recap } = await service.summarize(USER, {}, NOW);

    expect(recap).toEqual({
      plannedMinutes: 0,
      doneMinutes: 0,
      notThisTimeCount: 0,
      onTimeCount: 0,
    });
  });

  it("measures each buffer from the last unfinished prep before its due time", async () => {
    const prisma = makePrisma();
    const service = await makeService(prisma);

    const { buffers } = await service.summarize(USER, {}, NOW);

    expect(buffers).toEqual([
      {
        sessionId: "exam-1",
        title: "Calculus",
        type: "EXAM",
        dueAt: "2026-11-02T02:00:00.000Z",
        // Last prep ends 2026-10-29 01:00; due 2026-11-02 02:00: 4 days + 1 hour.
        bufferDays: 4,
      },
      {
        sessionId: "assign-1",
        title: "Essay",
        type: "ASSIGNMENT",
        dueAt: "2026-11-10T10:00:00.000Z",
        bufferDays: 0,
      },
      {
        sessionId: "assign-2",
        title: "Lab",
        type: "ASSIGNMENT",
        dueAt: "2026-10-30T10:00:00.000Z",
        bufferDays: null,
      },
    ]);
  });

  it("only considers unfinished, live, non-skipped prep TASKs", async () => {
    const prisma = makePrisma();
    const service = await makeService(prisma);

    await service.summarize(USER, {}, NOW);

    const prepWhere = prisma.session.findMany.mock.calls[1][0].where;
    expect(prepWhere).toMatchObject({
      userId: USER.id,
      type: "TASK",
      deleted: false,
      skipped: false,
      events: { none: { eventType: "DONE" } },
      prepForSessionId: { in: ["exam-1", "assign-1", "assign-2"] },
    });
  });

  it("skips the prep query when no exam or assignment is due in 30 days", async () => {
    const prisma = makePrisma();
    prisma.session.findMany.mockResolvedValueOnce([]);
    const service = await makeService(prisma);

    const { buffers } = await service.summarize(USER, {}, NOW);

    expect(buffers).toEqual([]);
    expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid window before querying", async () => {
    const prisma = makePrisma();
    const service = await makeService(prisma);

    await expect(
      service.summarize(USER, { from: "2026-01-01", to: "2026-12-31" }, NOW),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.session.aggregate).not.toHaveBeenCalled();
  });
});
