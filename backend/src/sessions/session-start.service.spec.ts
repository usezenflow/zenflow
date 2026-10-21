/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { SessionStartService } from "./session-start.service";
import type { SessionRow } from "./types/session-row";

const user = { id: "user-1", timezone: "UTC" } as User;
const START = new Date("2026-10-20T09:00:00.000Z");
const MIN = 60_000;
const inSlot = new Date(START.getTime() + 10 * MIN);

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s-1",
    durationMinutes: 60,
    type: "TASK",
    source: "AUTO",
    scheduledStartTime: START,
    tags: [],
    ...over,
  } as SessionRow;
}

async function makeService(found: SessionRow | null, existingStart = false) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    session: { findFirst: jest.fn().mockResolvedValue(found) },
    sessionEvent: {
      findFirst: jest.fn().mockResolvedValue(existingStart ? { id: 1n } : null),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: 2n });
      }),
    },
  };
  const feedback = {
    applyDelayedReward: jest.fn().mockResolvedValue(undefined),
    reinforcePreferenceMatrix: jest.fn().mockResolvedValue(undefined),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionStartService,
      { provide: PrismaService, useValue: prisma },
      { provide: SchedulingFeedbackService, useValue: feedback },
    ],
  }).compile();
  return {
    service: module.get(SessionStartService),
    created,
    feedback,
    findFirst: prisma.session.findFirst,
  };
}

describe("SessionStartService.record", () => {
  it("writes one START event while the app is open inside the slot", async () => {
    const { service, created } = await makeService(row());

    expect(await service.record("s-1", user, inSlot)).toEqual({
      recorded: true,
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      sessionId: "s-1",
      userId: "user-1",
      eventType: "START",
      occurredAt: inSlot,
      rewardScore: 1,
    });
  });

  it("rewards LinUCB and the preference matrix as soon as it is recorded", async () => {
    const { service, feedback } = await makeService(row());

    await service.record("s-1", user, inSlot);

    expect(feedback.applyDelayedReward).toHaveBeenCalledWith(
      "user-1",
      "s-1",
      2n,
      1,
      null,
    );
    expect(feedback.reinforcePreferenceMatrix).toHaveBeenCalledWith(
      "user-1",
      START.getTime(),
      "UTC",
      0.25,
    );
  });

  it("counts the exact start", async () => {
    const { service } = await makeService(row());

    expect(await service.record("s-1", user, START)).toEqual({
      recorded: true,
    });
  });

  it("writes nothing before the slot or at its end", async () => {
    const before = await makeService(row());
    expect(
      await before.service.record("s-1", user, new Date(START.getTime() - 1)),
    ).toEqual({ recorded: false });
    expect(before.created).toHaveLength(0);

    const after = await makeService(row());
    expect(
      await after.service.record(
        "s-1",
        user,
        new Date(START.getTime() + 60 * MIN),
      ),
    ).toEqual({ recorded: false });
    expect(after.created).toHaveLength(0);
  });

  it("writes only one START per slot", async () => {
    const { service, created } = await makeService(row(), true);

    expect(await service.record("s-1", user, inSlot)).toEqual({
      recorded: false,
    });
    expect(created).toHaveLength(0);
  });

  it("only looks at unmoved placed tasks", async () => {
    const { service, findFirst } = await makeService(row());

    await service.record("s-1", user, inSlot);

    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      id: "s-1",
      userId: "user-1",
      type: "TASK",
      source: { in: ["USER", "AUTO"] },
      lastMovedAt: null,
    });
  });

  it("ignores an unknown session", async () => {
    const { service, created } = await makeService(null);

    expect(await service.record("missing", user, inSlot)).toEqual({
      recorded: false,
    });
    expect(created).toHaveLength(0);
  });
});
