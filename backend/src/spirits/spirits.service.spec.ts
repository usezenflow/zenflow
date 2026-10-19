import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { SpiritsService } from "./spirits.service";
import type { User } from "../../generated/prisma";
import { rollSpirit } from "./core/roll";

type Fn = jest.Mock;
type PrismaMock = {
  egg: Record<string, Fn>;
  spirit: Record<string, Fn>;
  sessionEvent: Record<string, Fn>;
  sparkLedger: Record<string, Fn>;
  $transaction: Fn;
};

const SECRET = "test-secret";
const NOW = new Date("2026-10-18T10:00:00Z");
const user = {
  id: "user-1",
  timezone: "UTC",
  createdAt: new Date("2026-10-01T00:00:00Z"),
} as unknown as User;

function startAt(id: number, iso: string) {
  return {
    id: BigInt(id),
    occurredAt: new Date(iso),
    eventType: "START",
    sessionId: null,
    session: null,
  };
}

function assignmentDoneAt(id: number, iso: string, sessionId: string) {
  return {
    id: BigInt(id),
    occurredAt: new Date(iso),
    eventType: "COMPLETE",
    sessionId,
    session: {
      type: "ASSIGNMENT",
      scheduledStartTime: new Date("2026-10-30T00:00:00Z"),
      prepForSessionId: null,
      prepForSession: null,
    },
  };
}

function prepForAssignmentDoneAt(
  id: number,
  iso: string,
  assignmentId: string,
) {
  return {
    id: BigInt(id),
    occurredAt: new Date(iso),
    eventType: "COMPLETE",
    sessionId: `prep-${id}`,
    session: {
      type: "TASK",
      scheduledStartTime: new Date("2026-10-18T09:00:00Z"),
      prepForSessionId: assignmentId,
      prepForSession: { type: "ASSIGNMENT" },
    },
  };
}

function prepDoneAt(
  id: number,
  iso: string,
  slotIso: string,
  sessionId = `prep-${id}`,
) {
  return {
    id: BigInt(id),
    occurredAt: new Date(iso),
    eventType: "COMPLETE",
    sessionId,
    session: { scheduledStartTime: new Date(slotIso) },
  };
}

describe("SpiritsService", () => {
  let service: SpiritsService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      egg: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      spirit: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      sessionEvent: { findMany: jest.fn().mockResolvedValue([]) },
      sparkLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SpiritsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => SECRET } },
      ],
    }).compile();
    service = module.get(SpiritsService);
  });

  it("grants at most the daily cap of sparks from one day", async () => {
    const egg = {
      id: "egg-1",
      status: "INCUBATING",
      sparks: 0,
      createdAt: user.createdAt,
    };
    prisma.egg.findFirst.mockResolvedValue(egg);
    prisma.egg.findUniqueOrThrow.mockResolvedValue(egg);
    prisma.sessionEvent.findMany.mockResolvedValue([
      startAt(1, "2026-10-18T08:00:00Z"),
      startAt(2, "2026-10-18T09:00:00Z"),
      startAt(3, "2026-10-18T09:30:00Z"),
      startAt(4, "2026-10-18T09:45:00Z"),
    ]);
    prisma.sparkLedger.createMany.mockResolvedValue({ count: 3 });

    await service.overview(user, NOW);

    const calls = prisma.sparkLedger.createMany.mock.calls as unknown[][];
    const data = (calls[0][0] as { data: { day: string }[] }).data;
    expect(data).toHaveLength(3);
    expect(data.every((row: { day: string }) => row.day === "2026-10-18")).toBe(
      true,
    );
  });

  it("does not grant a start that already has a spark", async () => {
    const egg = {
      id: "egg-1",
      status: "INCUBATING",
      sparks: 0,
      createdAt: user.createdAt,
    };
    prisma.egg.findFirst.mockResolvedValue(egg);
    prisma.egg.findUniqueOrThrow.mockResolvedValue(egg);
    prisma.sessionEvent.findMany.mockResolvedValue([
      startAt(7, "2026-10-18T08:00:00Z"),
    ]);
    prisma.sparkLedger.findMany
      .mockResolvedValueOnce([{ sessionEventId: BigInt(7) }])
      .mockResolvedValueOnce([]);

    await service.overview(user, NOW);

    expect(prisma.sparkLedger.createMany).not.toHaveBeenCalled();
  });

  describe("prep plan completions", () => {
    const egg = {
      id: "egg-1",
      status: "INCUBATING",
      sparks: 0,
      createdAt: user.createdAt,
    };
    const granted = () => {
      const calls = prisma.sparkLedger.createMany.mock.calls as unknown[][];
      return calls.length === 0
        ? []
        : (calls[0][0] as { data: { sessionId: string | null }[] }).data;
    };

    beforeEach(() => {
      prisma.egg.findFirst.mockResolvedValue(egg);
      prisma.egg.findUniqueOrThrow.mockResolvedValue(egg);
      prisma.sparkLedger.createMany.mockResolvedValue({ count: 1 });
    });

    it("sparks a prep checked off at or after its slot start", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        prepDoneAt(1, "2026-10-18T09:30:00Z", "2026-10-18T09:00:00Z"),
      ]);

      await service.overview(user, NOW);

      expect(granted().map((r) => r.sessionId)).toEqual(["prep-1"]);
    });

    it("does not spark a prep checked off before its slot", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        prepDoneAt(1, "2026-10-18T07:00:00Z", "2026-10-18T09:00:00Z"),
      ]);

      await service.overview(user, NOW);

      expect(granted()).toEqual([]);
    });

    it("sparks one prep once even if it was re-checked", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        prepDoneAt(1, "2026-10-18T09:30:00Z", "2026-10-18T09:00:00Z", "p"),
        prepDoneAt(2, "2026-10-18T09:40:00Z", "2026-10-18T09:00:00Z", "p"),
      ]);

      await service.overview(user, NOW);

      expect(granted()).toHaveLength(1);
    });

    it("does not spark a prep that already has one", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        prepDoneAt(3, "2026-10-18T09:30:00Z", "2026-10-18T09:00:00Z", "p"),
      ]);
      prisma.sparkLedger.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ sessionId: "p" }]);

      await service.overview(user, NOW);

      expect(granted()).toEqual([]);
    });

    it("sparks a completed assignment, whenever it is done", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        assignmentDoneAt(1, "2026-10-18T09:30:00Z", "asg-1"),
      ]);

      await service.overview(user, NOW);

      expect(granted().map((r) => r.sessionId)).toEqual(["asg-1"]);
    });

    it("pays an assignment and its plan one spark together", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        prepForAssignmentDoneAt(1, "2026-10-18T09:30:00Z", "asg-1"),
        assignmentDoneAt(2, "2026-10-18T09:40:00Z", "asg-1"),
      ]);

      await service.overview(user, NOW);

      expect(granted().map((r) => r.sessionId)).toEqual(["asg-1"]);
    });

    it("shares the daily cap with starts", async () => {
      prisma.sessionEvent.findMany.mockResolvedValue([
        startAt(1, "2026-10-18T08:00:00Z"),
        startAt(2, "2026-10-18T08:10:00Z"),
        startAt(3, "2026-10-18T08:20:00Z"),
        prepDoneAt(4, "2026-10-18T09:30:00Z", "2026-10-18T09:00:00Z"),
      ]);

      await service.overview(user, NOW);

      expect(granted()).toHaveLength(3);
    });
  });

  it("refuses to hatch an egg that is still incubating", async () => {
    prisma.egg.findFirst.mockResolvedValue({
      id: "egg-1",
      status: "INCUBATING",
      userId: "user-1",
    });

    await expect(service.hatch(user, "egg-1", NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.spirit.create).not.toHaveBeenCalled();
  });

  it("hatches the seeded spirit and opens the next egg", async () => {
    prisma.egg.findFirst.mockResolvedValue({
      id: "egg-1",
      status: "READY",
      userId: "user-1",
    });
    prisma.egg.updateMany.mockResolvedValue({ count: 1 });
    prisma.egg.findUniqueOrThrow.mockResolvedValue({
      id: "egg-2",
      status: "INCUBATING",
      sparks: 0,
      createdAt: NOW,
    });

    const result = await service.hatch(user, "egg-1", NOW);

    const expected = rollSpirit({
      userId: "user-1",
      eggId: "egg-1",
      secret: SECRET,
    });
    expect(result.spirit.spiritId).toBe(expected.id);
    expect(prisma.spirit.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        eggId: "egg-1",
        spiritId: expected.id,
        rarity: expected.rarity.toUpperCase(),
      },
    });
    expect(result.egg.id).toBe("egg-2");
  });
});
