import { Test, TestingModule } from "@nestjs/testing";
import { SCHEDULING_ARMS, type BanditArmStateWire } from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";
import { BanditArmStateRepository } from "./bandit-arm-state.repository";

async function make(overrides: Record<string, unknown> = {}) {
  const prisma = {
    banditArmState: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      ...overrides,
    },
    $transaction: jest
      .fn()
      .mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BanditArmStateRepository,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return {
    repo: module.get<BanditArmStateRepository>(BanditArmStateRepository),
    prisma,
  };
}

function allArms(
  value: BanditArmStateWire,
): Record<string, BanditArmStateWire> {
  return Object.fromEntries(SCHEDULING_ARMS.map((arm) => [arm, value]));
}

describe("BanditArmStateRepository.loadAll", () => {
  it("returns all 24 hour arms, cold where no row exists", async () => {
    const { repo } = await make();
    const out = await repo.loadAll("u1");
    expect(Object.keys(out).sort()).toEqual([...SCHEDULING_ARMS].sort());
    expect(out.HOUR_09).toEqual({ A: [], b: [] });
  });

  it("returns the stored state for arms that have a row", async () => {
    const { repo } = await make({
      findMany: jest
        .fn()
        .mockResolvedValue([{ arm: "HOUR_21", A: [1, 0, 0, 1], b: [2, 3] }]),
    });
    const out = await repo.loadAll("u1");
    expect(out.HOUR_21).toEqual({ A: [1, 0, 0, 1], b: [2, 3] });
    expect(out.HOUR_09).toEqual({ A: [], b: [] });
  });
});

describe("BanditArmStateRepository.replaceAll", () => {
  it("upserts every one of the 24 arms in one transaction", async () => {
    const { repo, prisma } = await make();
    const arms = allArms({ A: [1], b: [2] });
    await repo.replaceAll("u1", arms);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.banditArmState.upsert).toHaveBeenCalledTimes(24);
    expect(prisma.banditArmState.upsert).toHaveBeenCalledWith({
      where: { userId_arm: { userId: "u1", arm: "HOUR_21" } },
      create: { userId: "u1", arm: "HOUR_21", A: [1], b: [2] },
      update: { A: [1], b: [2] },
    });
  });

  it("swallows a write failure", async () => {
    const { repo } = await make({
      upsert: jest.fn().mockRejectedValue(new Error("connection reset")),
    });
    await expect(
      repo.replaceAll("u1", allArms({ A: [], b: [] })),
    ).resolves.toBeUndefined();
  });
});
