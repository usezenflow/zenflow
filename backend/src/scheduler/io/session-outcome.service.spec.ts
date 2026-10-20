/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { SessionOutcomeService } from "./session-outcome.service";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditService } from "../../bandit/bandit.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import {
  OUTCOME_GRACE_MS,
  OUTCOME_MISS_CUTOFF_MS,
} from "../../common/constants";
import { BANDIT_MODEL_VERSION } from "../constants";

interface Row {
  id: string;
  userId: string;
  type: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  events: { id: bigint; occurredAt: Date }[];
  tags: { name: string }[];
  user: { timezone: string };
}

const START = new Date("2026-06-15T08:00:00.000Z");
const END = new Date("2026-06-15T09:00:00.000Z");
/** Elapsed past end + grace, before the miss cutoff. */
const SETTLE_NOW = new Date(END.getTime() + OUTCOME_GRACE_MS);
/** Past end + cutoff. */
const MISS_NOW = new Date(END.getTime() + OUTCOME_MISS_CUTOFF_MS);

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "user-1",
    type: "TASK",
    scheduledStartTime: START,
    durationMinutes: 60,
    events: [],
    tags: [],
    user: { timezone: "UTC" },
    ...over,
  };
}

async function makeService(
  batches: Row[][],
  opts: { proposal?: Record<string, unknown> | null } = {},
) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const events: Record<string, unknown>[] = [];
  const eventUpdates: { id: bigint; data: Record<string, unknown> }[] = [];
  const userUpdates: { id: string; data: Record<string, unknown> }[] = [];

  const findMany = jest.fn();
  batches.forEach((b) => findMany.mockResolvedValueOnce(b));
  findMany.mockResolvedValue([]);

  let eventSeq = 0;
  const claimedIds = new Set<string>();
  const tx = {
    session: {
      // Claim semantics: only the first updateMany per id wins.
      updateMany: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          if (claimedIds.has(args.where.id))
            return Promise.resolve({ count: 0 });
          claimedIds.add(args.where.id);
          updates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    sessionEvent: {
      updateMany: jest.fn(
        (args: { where: { id: bigint }; data: Record<string, unknown> }) => {
          eventUpdates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({ count: 1 });
        },
      ),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        events.push(args.data);
        return Promise.resolve({ id: BigInt(++eventSeq) });
      }),
    },
    user: {
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          userUpdates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({});
        },
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      {
        preferenceMatrix: new Array<number>(168).fill(0),
        preferenceMatrixDecayedAt: null,
      },
    ]),
  };

  const banditUpdate = jest
    .fn()
    .mockResolvedValue({ A: [1, 0, 0, 1], b: [0.5, 0.5] });
  const armSave = jest.fn().mockResolvedValue(undefined);
  const bandit = { update: banditUpdate };
  const armStates = {
    loadAll: jest
      .fn()
      .mockResolvedValue({ MORNING: { A: [], b: [], version: 3 } }),
    save: armSave,
  };

  const prisma = {
    session: { findMany },
    slotProposal: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.proposal === undefined ? null : opts.proposal),
    },
    sessionEvent: { update: jest.fn().mockResolvedValue({}) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionOutcomeService,
      SchedulingFeedbackService,
      { provide: PrismaService, useValue: prisma },
      { provide: BanditService, useValue: bandit },
      { provide: BanditArmStateRepository, useValue: armStates },
    ],
  }).compile();

  return {
    service: module.get<SessionOutcomeService>(SessionOutcomeService),
    findMany,
    updates,
    events,
    eventUpdates,
    userUpdates,
    banditUpdate,
    armSave,
  };
}

describe("SessionOutcomeService.sweep", () => {
  const during = (ms: number) => new Date(START.getTime() + ms);
  const MIN = 60_000;

  describe("start", () => {
    it("settles a start inside the slot as +1 on the START event", async () => {
      const { service, events, eventUpdates } = await makeService([
        [row({ id: "s1", events: [{ id: 7n, occurredAt: during(5 * MIN) }] })],
      ]);

      expect(await service.sweep(SETTLE_NOW)).toBe(1);
      expect(eventUpdates).toEqual([{ id: 7n, data: { rewardScore: 1 } }]);
      expect(events).toHaveLength(0);
    });

    it("counts a start at the exact start", async () => {
      const { service, eventUpdates } = await makeService([
        [row({ id: "s1", events: [{ id: 7n, occurredAt: START }] })],
      ]);

      await service.sweep(SETTLE_NOW);

      expect(eventUpdates).toEqual([{ id: 7n, data: { rewardScore: 1 } }]);
    });

    it("rewards the first start inside the slot only", async () => {
      const { service, eventUpdates } = await makeService([
        [
          row({
            id: "s1",
            events: [
              { id: 3n, occurredAt: during(10 * MIN) },
              { id: 4n, occurredAt: during(20 * MIN) },
            ],
          }),
        ],
      ]);

      await service.sweep(SETTLE_NOW);

      expect(eventUpdates.map((u) => u.id)).toEqual([3n]);
    });

    it("ignores a start before the slot and writes LAPSED", async () => {
      const { service, events, eventUpdates } = await makeService([
        [row({ id: "s1", events: [{ id: 7n, occurredAt: during(-5 * MIN) }] })],
      ]);

      await service.sweep(MISS_NOW);

      expect(eventUpdates).toHaveLength(0);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: "LAPSED",
        rewardScore: -0.25,
      });
    });

    it("does not settle a start before end + grace", async () => {
      const { service, events, eventUpdates } = await makeService([
        [row({ id: "s1", events: [{ id: 7n, occurredAt: during(5 * MIN) }] })],
      ]);

      expect(await service.sweep(new Date(SETTLE_NOW.getTime() - 1))).toBe(0);
      expect(eventUpdates).toHaveLength(0);
      expect(events).toHaveLength(0);
    });
  });

  describe("lapse", () => {
    it("is not settled before the miss cutoff", async () => {
      const { service, events } = await makeService([[row({ id: "s1" })]]);

      expect(await service.sweep(SETTLE_NOW)).toBe(0);
      expect(events).toHaveLength(0);
    });

    it("writes a LAPSED event with -0.25 when no start lands by the cutoff", async () => {
      const { service, events } = await makeService([[row({ id: "s1" })]]);

      expect(await service.sweep(MISS_NOW)).toBe(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: "LAPSED",
        rewardScore: -0.25,
      });
    });
  });

  it("skips a session whose end + grace has not yet passed", async () => {
    const { service, updates, events } = await makeService([
      [
        row({
          id: "s1",
          scheduledStartTime: new Date("2026-06-15T10:59:00.000Z"),
          events: [
            { id: 7n, occurredAt: new Date("2026-06-15T10:59:00.000Z") },
          ],
        }),
      ],
    ]);

    expect(await service.sweep(new Date("2026-06-15T12:00:00.000Z"))).toBe(0);
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("only considers unmoved, unsettled, user-created TASKs", async () => {
    const { service, findMany } = await makeService([[]]);

    await service.sweep(SETTLE_NOW);

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      type: "TASK",
      source: { in: ["USER", "AUTO"] },
      retainedAt: null,
      lastMovedAt: null,
      deleted: false,
    });
  });

  it("is idempotent: an overlapping sweep settles and records nothing twice", async () => {
    const r = row({ id: "s1", events: [{ id: 7n, occurredAt: START }] });
    const { service, events, eventUpdates } = await makeService([[r], [r]]);

    expect(await service.sweep(SETTLE_NOW)).toBe(1);
    expect(await service.sweep(SETTLE_NOW)).toBe(0);
    expect(eventUpdates).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it("paginates by cursor across full batches", async () => {
    const started = (id: string) =>
      row({ id, events: [{ id: 1n, occurredAt: START }] });
    const big = Array.from({ length: 100 }, (_, i) => started(`s${i}`));
    const rest = [started("s100")];
    const { service, findMany } = await makeService([big, rest]);

    expect(await service.sweep(SETTLE_NOW)).toBe(101);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].cursor).toEqual({ id: "s99" });
  });

  it("delivers +1 to the LinUCB arm for a start", async () => {
    const { service, banditUpdate, armSave } = await makeService(
      [[row({ id: "s1", events: [{ id: 7n, occurredAt: START }] })]],
      {
        proposal: {
          id: "prop-1",
          selectedArm: "MORNING",
          featureVector: [0.1, 0.2, 0.3, -1, 0, 0.25, 1],
          modelVersion: BANDIT_MODEL_VERSION,
        },
      },
    );

    await service.sweep(SETTLE_NOW);

    expect(banditUpdate).toHaveBeenCalledTimes(1);
    const [arm, x, reward] = banditUpdate.mock.calls[0];
    expect(arm).toBe("MORNING");
    expect(x).toEqual([0.1, 0.2, 0.3, -1, 0, 0.25, 1]);
    expect(reward).toBe(1);
    expect(armSave).toHaveBeenCalledWith(
      "user-1",
      "MORNING",
      [1, 0, 0, 1],
      [0.5, 0.5],
      3,
    );
  });

  it("delivers -0.25 to the LinUCB arm for a lapsed placement", async () => {
    const { service, banditUpdate } = await makeService([[row({ id: "s1" })]], {
      proposal: {
        id: "prop-1",
        selectedArm: "MORNING",
        featureVector: [0.1, 0.2, 0.3, -1, 0, 0.25, 1],
        modelVersion: BANDIT_MODEL_VERSION,
      },
    });

    await service.sweep(MISS_NOW);

    expect(banditUpdate).toHaveBeenCalledTimes(1);
    expect(banditUpdate.mock.calls[0][2]).toBe(-0.25);
  });

  it("skips the bandit update when there is no LinUCB proposal", async () => {
    const { service, banditUpdate } = await makeService([
      [row({ id: "s1", events: [{ id: 7n, occurredAt: START }] })],
    ]);
    await service.sweep(SETTLE_NOW);
    expect(banditUpdate).not.toHaveBeenCalled();
  });

  it("reinforces the preference matrix on the kept hour for a start", async () => {
    const { service, userUpdates } = await makeService([
      [
        row({
          id: "s1",
          scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"), // Monday 09:00 UTC
          events: [
            { id: 7n, occurredAt: new Date("2026-06-15T09:05:00.000Z") },
          ],
        }),
      ],
    ]);

    await service.sweep(new Date("2026-06-15T11:00:00.000Z"));

    expect(userUpdates).toHaveLength(1);
    const written = userUpdates[0].data.preferenceMatrix as number[];
    // Monday (wd=1), hour 9 → index 9; PREFERENCE_LEARNING_RATE · 0.25.
    expect(written[9]).toBeCloseTo(0.05);
  });

  it("lowers the preference matrix on the kept hour for a lapse", async () => {
    const { service, userUpdates } = await makeService([
      [
        row({
          id: "s1",
          scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"), // Monday 09:00 UTC
        }),
      ],
    ]);

    // Ends 10:00 on the 15th; the miss cutoff is 24 h after the end.
    await service.sweep(new Date("2026-06-16T11:00:00.000Z"));

    expect(userUpdates).toHaveLength(1);
    const written = userUpdates[0].data.preferenceMatrix as number[];
    // Monday 09:00 → index 9; PREFERENCE_LEARNING_RATE · 0.25 · LAPSED (-0.25).
    expect(written[9]).toBeCloseTo(-0.0125);
  });
});
