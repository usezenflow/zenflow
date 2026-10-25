import { NotFoundException } from "@nestjs/common";
import { SessionEventType, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { SessionDoneService } from "./session-done.service";

jest.mock("./session-mapper", () => ({
  toSessionSnapshot: () => ({ scheduledStartTime: null }),
}));

const USER = { id: "u1", timezone: "UTC" } as User;
const NOW = new Date("2026-10-26T10:00:00.000Z");

function makePrisma(
  overrides: { row?: object | null; existing?: boolean } = {},
) {
  const row = overrides.row === undefined
    ? { id: "s1", scheduledStartTime: NOW }
    : overrides.row;
  return {
    session: { findFirst: jest.fn().mockResolvedValue(row) },
    sessionEvent: {
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.existing ? { id: 1n } : null),
      create: jest.fn().mockResolvedValue({ id: 1n }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const schedulingFeedback = {
  applyDelayedReward: jest.fn().mockResolvedValue(undefined),
  reinforcePreferenceMatrix: jest.fn().mockResolvedValue(undefined),
};

function build(prisma: ReturnType<typeof makePrisma>) {
  return new SessionDoneService(
    prisma as unknown as PrismaService,
    schedulingFeedback as unknown as SchedulingFeedbackService,
  );
}

describe("SessionDoneService.mark", () => {
  it("writes one DONE event and dispatches the reward", async () => {
    const prisma = makePrisma();

    const got = await build(prisma).mark("s1", USER, NOW);

    expect(got).toEqual({ done: true });
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: "s1",
        userId: "u1",
        eventType: SessionEventType.DONE,
        occurredAt: NOW,
        rewardScore: 1.0,
      }),
      select: { id: true },
    });
    expect(schedulingFeedback.applyDelayedReward).toHaveBeenCalledWith(
      "u1",
      "s1",
      1n,
      1.0,
      null,
    );
    expect(schedulingFeedback.reinforcePreferenceMatrix).toHaveBeenCalledWith(
      "u1",
      expect.any(Number),
      "UTC",
      0.25,
    );
  });

  it("does not write a second DONE event for the same task", async () => {
    const prisma = makePrisma({ existing: true });

    const got = await build(prisma).mark("s1", USER, NOW);

    expect(got).toEqual({ done: true });
    expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
  });

  it("only looks at this user's placed TASKs", async () => {
    const prisma = makePrisma();

    await build(prisma).mark("s1", USER, NOW);

    expect(prisma.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "s1",
          userId: "u1",
          deleted: false,
          type: "TASK",
          scheduledStartTime: { not: null },
        }),
      }),
    );
  });

  it("rejects a task that is not placed or not the user's", async () => {
    const prisma = makePrisma({ row: null });

    await expect(build(prisma).mark("s1", USER, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
  });
});

describe("SessionDoneService.clear", () => {
  it("removes this user's DONE events for the task", async () => {
    const prisma = makePrisma();

    const got = await build(prisma).clear("s1", USER);

    expect(got).toEqual({ done: false });
    expect(prisma.sessionEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        sessionId: "s1",
        userId: "u1",
        eventType: SessionEventType.DONE,
      },
    });
  });
});
