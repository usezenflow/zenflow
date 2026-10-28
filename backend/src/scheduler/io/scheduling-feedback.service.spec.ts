/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { BanditService } from "../../bandit/bandit.service";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { ARM_LAYOUT, BANDIT_MODEL_VERSION, DELETE_REWARD } from "../constants";
import { SCHEDULING_ARMS, type BanditArmStateWire } from "@zenflow/shared";

/**
 * `SchedulingFeedbackService.onFirstMove` — the delayed graded LinUCB penalty
 * for the first user drag of a LinUCB-placed session. Absorbs what
 * `sessions.service.spec.ts` used to assert about `applyBanditMoveFeedback`.
 */

const X = [0.1, 0.2, 0.3, -1, 0, 0.25, 1]; // length FEATURE_DIM

/** All 24 hour arms, the played hour (`HOUR_09`) set to `hour`. */
function allArms(
  hour: BanditArmStateWire = { A: [], b: [] },
): Record<string, BanditArmStateWire> {
  return Object.fromEntries(
    SCHEDULING_ARMS.map((arm) => [
      arm,
      arm === "HOUR_09" ? hour : { A: [], b: [] },
    ]),
  );
}

async function makeSvc(over: {
  proposal?: unknown;
  updateResult?: unknown;
  sameTitleCount?: number;
}) {
  const slotFindFirst = jest.fn().mockResolvedValue(
    over.proposal === undefined
      ? {
          id: "p1",
          selectedArm: "HOUR_09",
          featureVector: X,
          modelVersion: `py-${ARM_LAYOUT}-0123456789ab`,
        }
      : over.proposal,
  );
  const eventUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    slotProposal: { findFirst: slotFindFirst },
    session: {
      count: jest.fn().mockResolvedValue(over.sameTitleCount ?? 0),
    },
    sessionEvent: { updateMany: eventUpdate },
  };
  const bandit = {
    update: jest
      .fn()
      .mockResolvedValue(
        over.updateResult ?? { arms: allArms({ A: [1], b: [0.5] }) },
      ),
  };
  const armStates = {
    loadAll: jest
      .fn()
      .mockResolvedValue(allArms({ A: [1, 0, 0, 1], b: [0.5, 0.5] })),
    replaceAll: jest.fn().mockResolvedValue(undefined),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SchedulingFeedbackService,
      { provide: PrismaService, useValue: prisma },
      { provide: BanditService, useValue: bandit },
      { provide: BanditArmStateRepository, useValue: armStates },
    ],
  }).compile();
  const svc = module.get<SchedulingFeedbackService>(SchedulingFeedbackService);
  return { svc, bandit, armStates, eventUpdate };
}

describe("SchedulingFeedbackService.onFirstMove", () => {
  it("grades a drag by displacement and pushes the reward to /update, then links the event", async () => {
    const { svc, bandit, armStates, eventUpdate } = await makeSvc({});

    await svc.onFirstMove("u1", "s1", 42n, 120);

    // reward = -min(1, 120/240) = -0.5
    expect(bandit.update).toHaveBeenCalledWith(
      "HOUR_09",
      X,
      -0.5,
      expect.objectContaining({
        HOUR_09: { A: [1, 0, 0, 1], b: [0.5, 0.5] },
      }),
    );
    expect(armStates.replaceAll).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ HOUR_09: { A: [1], b: [0.5] } }),
    );
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { slotProposalId: "p1", policy: "LINUCB" },
    });
  });

  it("sends reward 0 for a resize-only move (zero drag distance)", async () => {
    const { svc, bandit } = await makeSvc({});
    await svc.onFirstMove("u1", "s1", 1n, 0);
    expect(bandit.update.mock.calls[0][2]).toBe(0);
  });

  it("drops the reward for a proposal made under an older vector layout (d=22)", async () => {
    const { svc, bandit, eventUpdate } = await makeSvc({
      proposal: {
        id: "p1",
        selectedArm: "HOUR_09",
        featureVector: new Array<number>(22).fill(0),
      },
    });
    await svc.onFirstMove("u1", "s1", 1n, 60);
    expect(bandit.update).not.toHaveBeenCalled();
    expect(eventUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["an older Python build without the arm layout", "py-0123456789ab"],
    ["another arm layout", "py-arms8-v1-0123456789ab"],
    ["no model version", null],
  ])(
    "drops the reward for a proposal stamped with %s",
    async (_name, modelVersion) => {
      const { svc, bandit, eventUpdate } = await makeSvc({
        proposal: {
          id: "p1",
          selectedArm: "HOUR_09",
          featureVector: X,
          modelVersion,
        },
      });
      await svc.onFirstMove("u1", "s1", 1n, 60);
      expect(bandit.update).not.toHaveBeenCalled();
      expect(eventUpdate).not.toHaveBeenCalled();
    },
  );

  it("accepts a proposal from the TypeScript fallback model", async () => {
    const { svc, bandit } = await makeSvc({
      proposal: {
        id: "p1",
        selectedArm: "HOUR_09",
        featureVector: X,
        modelVersion: BANDIT_MODEL_VERSION,
      },
    });
    await svc.onFirstMove("u1", "s1", 1n, 60);
    expect(bandit.update).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no LinUCB proposal for the session", async () => {
    const { svc, bandit } = await makeSvc({ proposal: null });
    await svc.onFirstMove("u1", "s1", 1n, 60);
    expect(bandit.update).not.toHaveBeenCalled();
  });

  it("swallows a bandit failure without throwing", async () => {
    const { svc } = await makeSvc({});
    // loadAll returns a state, /update rejects — must not bubble.
    const { svc: svc2, bandit } = await makeSvc({});
    bandit.update.mockRejectedValueOnce(new Error("bandit down"));
    await expect(svc2.onFirstMove("u1", "s1", 1n, 60)).resolves.toBeUndefined();
    await expect(svc.onFirstMove("u1", "s1", 1n, 60)).resolves.toBeUndefined();
  });
});

describe("SchedulingFeedbackService.onPairwiseWin", () => {
  it("folds a positive reward into the arm LinUCB proposed", async () => {
    const { svc, bandit, armStates } = await makeSvc({});

    await svc.onPairwiseWin("u1", "p1");

    expect(bandit.update).toHaveBeenCalledWith(
      "HOUR_09",
      X,
      0.5,
      expect.objectContaining({
        HOUR_09: { A: [1, 0, 0, 1], b: [0.5, 0.5] },
      }),
    );
    expect(armStates.replaceAll).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ HOUR_09: { A: [1], b: [0.5] } }),
    );
  });

  it("does nothing when the proposal has no model pick", async () => {
    const { svc, bandit } = await makeSvc({ proposal: null });
    await svc.onPairwiseWin("u1", "p1");
    expect(bandit.update).not.toHaveBeenCalled();
  });
});

describe("SchedulingFeedbackService.onDelete", () => {
  const now = new Date("2026-06-10T10:00:00.000Z");
  const removed = {
    id: "s1",
    title: "Essay",
    type: "TASK" as const,
    source: "USER" as const,
    scheduledStartTime: new Date("2026-06-12T10:00:00.000Z"),
    createdAt: new Date("2026-06-10T09:00:00.000Z"),
    lastMovedAt: null,
  };

  it("records the delete reward on the event and leaves the arm alone in shadow mode", async () => {
    const { svc, bandit, eventUpdate } = await makeSvc({});

    await svc.onDelete("u1", removed, 9n, now);

    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 9n },
      data: { rewardScore: DELETE_REWARD },
    });
    expect(bandit.update).not.toHaveBeenCalled();
  });

  it("records no reward for a delete that replaces a session with the same title made within the hour", async () => {
    const { svc, eventUpdate } = await makeSvc({ sameTitleCount: 1 });
    await svc.onDelete("u1", removed, 9n, now);
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 9n },
      data: { rewardScore: 0 },
    });
  });
});
