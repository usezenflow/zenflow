import { Test, type TestingModule } from "@nestjs/testing";
import type { User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { PREP_DAILY_CAP } from "../constants";
import { PrepSizingClient } from "./prep-sizing-client.service";
import { PrepPlanService, type PrepParent } from "./prep-plan.service";
import { TaskPlacementService } from "./task-placement.service";

const USER = { id: "u1", lang: "EN_US" } as User;
const NOW = new Date("2026-10-17T02:00:00.000Z");
const PARENT: PrepParent = {
  id: "exam-1",
  title: "Calculus",
  kind: "EXAM",
  deadline: new Date("2026-10-27T02:00:00.000Z"),
};
const SIZED = {
  weak: 0.5,
  durationMinutes: 180,
  windowStartMs: Date.parse("2026-10-25T02:00:00.000Z"),
  deadlineMs: PARENT.deadline.getTime(),
  feasible: true,
};

function makePrisma(over: { existing?: boolean; made?: number } = {}) {
  const created: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const prisma = {
    session: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.existing ? { id: "x" } : null),
      count: jest.fn().mockResolvedValue(over.made ?? 0),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: "prep-1", durationMinutes: 180 });
      }),
      deleteMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) => {
        deleted.push(...where.id.in);
        return Promise.resolve({ count: 1 });
      }),
    },
    sessionEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    studentMark: {
      findMany: jest.fn().mockResolvedValue([{ letter: "F", credits: 3 }]),
    },
    studentProfile: {
      findUnique: jest.fn().mockResolvedValue({ gpa4: 1.2 }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  return { prisma, created, deleted };
}

async function makeService(opts: {
  prisma: ReturnType<typeof makePrisma>["prisma"];
  sized?: Partial<typeof SIZED>;
  start?: Date | null;
}) {
  const sizing = {
    size: jest.fn().mockResolvedValue({ ...SIZED, ...opts.sized }),
  };
  const placement = {
    placeOnDeadlineChange: jest.fn().mockResolvedValue({
      scheduledStartTime:
        opts.start === undefined
          ? new Date("2026-10-25T10:00:00.000Z")
          : opts.start,
      appliedPolicy: "HEURISTIC",
      slotProposalId: null,
      alternativeSlot: null,
      divergent: false,
    }),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PrepPlanService,
      { provide: PrismaService, useValue: opts.prisma },
      { provide: PrepSizingClient, useValue: sizing },
      { provide: TaskPlacementService, useValue: placement },
    ],
  }).compile();
  return {
    service: module.get(PrepPlanService),
    sizing,
    placement,
  };
}

describe("PrepPlanService", () => {
  it("skips a parent that already has a prep plan, deleted or not", async () => {
    const h = makePrisma({ existing: true });
    const { service, sizing } = await makeService({ prisma: h.prisma });

    const got = await service.planFor(USER, PARENT, NOW);

    expect(got).toEqual({ status: "SKIPPED_EXISTS" });
    expect(sizing.size).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(0);
  });

  it("skips once the daily cap of automatic plans is reached", async () => {
    const h = makePrisma({ made: PREP_DAILY_CAP });
    const { service, sizing } = await makeService({ prisma: h.prisma });

    expect(await service.planFor(USER, PARENT, NOW)).toEqual({
      status: "SKIPPED_CAP",
    });
    expect(sizing.size).not.toHaveBeenCalled();
  });

  it("sends the marks and GPA to sizing and writes nothing when infeasible", async () => {
    const h = makePrisma();
    const { service, sizing } = await makeService({
      prisma: h.prisma,
      sized: { feasible: false },
    });

    expect(await service.planFor(USER, PARENT, NOW)).toEqual({
      status: "SKIPPED_INFEASIBLE",
    });
    expect(sizing.size).toHaveBeenCalledWith({
      kind: "EXAM",
      nowMs: NOW.getTime(),
      deadlineMs: PARENT.deadline.getTime(),
      marks: [{ letter: "F", credits: 3 }],
      avgGpa4: 1.2,
    });
    expect(h.created).toHaveLength(0);
  });

  it("creates an automatic TASK linked to its parent and places it in the window", async () => {
    const h = makePrisma();
    const { service, placement } = await makeService({ prisma: h.prisma });

    const got = await service.planFor(USER, PARENT, NOW);

    expect(got).toEqual({
      status: "PLACED",
      sessionId: "prep-1",
      startsAt: new Date("2026-10-25T10:00:00.000Z"),
    });
    expect(h.created[0]).toMatchObject({
      type: "TASK",
      source: "AUTO",
      title: "Prep for Calculus",
      durationMinutes: 180,
      prepForSessionId: "exam-1",
      userId: "u1",
    });
    expect(placement.placeOnDeadlineChange).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date(SIZED.windowStartMs),
        allowLastResort: false,
      }),
    );
  });

  it("titles the plan in Vietnamese for a Vietnamese student", async () => {
    const h = makePrisma();
    const { service } = await makeService({ prisma: h.prisma });

    await service.planFor({ ...USER, lang: "VI_VN" } as User, PARENT, NOW);

    expect(h.created[0]).toMatchObject({ title: "Hoàn thành Calculus" });
  });

  it("removes the row and reports no slot when placement finds none", async () => {
    const h = makePrisma();
    const { service } = await makeService({ prisma: h.prisma, start: null });

    expect(await service.planFor(USER, PARENT, NOW)).toEqual({
      status: "SKIPPED_NO_SLOT",
    });
    expect(h.deleted).toEqual(["prep-1"]);
  });
});
