import { Test, TestingModule } from "@nestjs/testing";
import { SchedulingModel, type User } from "../../generated/prisma";
import { SlotPickService } from "./slot-pick.service";
import { PAIRWISE_KEEP_PREFERENCE_WEIGHT } from "../scheduler/constants";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";

const user = {
  id: "user-1",
  timezone: "UTC",
} as unknown as User;

const OLD_START = new Date("2026-06-11T08:00:00.000Z");
const ALT_START = new Date("2026-06-11T10:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Task",
    note: null,
    location: null,
    durationMinutes: 60,
    deadline: null,
    tags: [],
    series: null,
    type: "TASK",
    source: "USER",
    conflict: false,
    scheduledStartTime: OLD_START,
    lastMovedAt: null,
    userId: user.id,
    seriesId: null,
    externalKey: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function makeService(
  existing: ReturnType<typeof row>,
  siblings: { scheduledStartTime: Date; durationMinutes: number }[] = [],
  primaryPolicy: SchedulingModel = SchedulingModel.HEURISTIC,
) {
  const proposal = {
    id: "prop-1",
    primaryPolicy,
    heuristicProposal: {},
    modelProposal: { scheduledStartTime: ALT_START.toISOString() },
    pairwiseShown: true,
    chosenByUser: null,
    firstModifiedAt: null,
  };
  const tx = {
    sessionEvent: { create: jest.fn().mockResolvedValue({ id: 7n }) },
    session: {
      update: jest
        .fn()
        .mockResolvedValue({ ...existing, scheduledStartTime: ALT_START }),
    },
  };
  const prisma = {
    slotProposal: {
      findFirst: jest.fn().mockResolvedValue(proposal),
      update: jest.fn().mockResolvedValue({}),
    },
    session: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue(siblings),
    },
    notification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const schedulingFeedback = {
    onFirstMove: jest.fn().mockResolvedValue(undefined),
    reinforcePreferenceMove: jest.fn().mockResolvedValue(undefined),
    onPairwiseWin: jest.fn().mockResolvedValue(undefined),
    onPairwiseLoss: jest.fn().mockResolvedValue(undefined),
    reinforcePreferenceMatrix: jest.fn().mockResolvedValue(undefined),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SlotPickService,
      { provide: PrismaService, useValue: prisma },
      { provide: SchedulingFeedbackService, useValue: schedulingFeedback },
    ],
  }).compile();
  const service = module.get<SlotPickService>(SlotPickService);
  return { service, schedulingFeedback, prisma, tx };
}

describe("SlotPickService — matrix reinforcement", () => {
  it("picking the alternative on a never-moved session reinforces the matrix like a drag (old hour down, new hour up)", async () => {
    const { service, schedulingFeedback } = await makeService(row());

    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );

    expect(schedulingFeedback.onFirstMove).toHaveBeenCalledWith(
      user.id,
      "task-1",
      7n,
      120,
    expect.anything(),
    );
    expect(schedulingFeedback.reinforcePreferenceMove).toHaveBeenCalledWith(
      user.id,
      OLD_START.getTime(),
      ALT_START.getTime(),
      user.timezone,
      120,
    );
  });

  it("does not reinforce when the session was already moved", async () => {
    const { service, schedulingFeedback } = await makeService(
      row({ lastMovedAt: new Date("2026-06-10T00:00:00.000Z") }),
    );

    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );

    expect(schedulingFeedback.reinforcePreferenceMove).not.toHaveBeenCalled();
  });
});

describe("SlotPickService — pairwise reward for LinUCB", () => {
  it("rewards LinUCB when the user picks its option as the alternative", async () => {
    const { service, schedulingFeedback } = await makeService(row());
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );
    expect(schedulingFeedback.onPairwiseWin).toHaveBeenCalledWith(
      user.id,
      "prop-1",
    );
  });

  it("rewards LinUCB when the user keeps LinUCB's primary pick", async () => {
    const { service, schedulingFeedback } = await makeService(
      row(),
      [],
      SchedulingModel.LINUCB,
    );
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "primary" },
      user,
    );
    expect(schedulingFeedback.onPairwiseWin).toHaveBeenCalledWith(
      user.id,
      "prop-1",
    );
  });

  it("does not reward LinUCB when the user keeps the heuristic's primary pick", async () => {
    const { service, schedulingFeedback } = await makeService(row());
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "primary" },
      user,
    );
    expect(schedulingFeedback.onPairwiseWin).not.toHaveBeenCalled();
  });

  it("penalises LinUCB when the user keeps the heuristic's shown primary pick", async () => {
    const { service, schedulingFeedback } = await makeService(row());
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "primary" },
      user,
    );
    expect(schedulingFeedback.onPairwiseLoss).toHaveBeenCalledWith(
      "user-1",
      "prop-1",
    );
  });

  it("reinforces the kept heuristic slot in the preference matrix", async () => {
    const { service, schedulingFeedback } = await makeService(row());
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "primary" },
      user,
    );
    expect(schedulingFeedback.reinforcePreferenceMatrix).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
      expect.any(String),
      PAIRWISE_KEEP_PREFERENCE_WEIGHT,
    );
  });

  it("does not reinforce the matrix when LinUCB was primary", async () => {
    const { service, schedulingFeedback } = await makeService(
      row(),
      [],
      SchedulingModel.LINUCB,
    );
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "primary" },
      user,
    );
    expect(schedulingFeedback.reinforcePreferenceMatrix).not.toHaveBeenCalled();
  });

  it("marks the offer answered on any pick", async () => {
    const { service, prisma } = await makeService(row());
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "primary" },
      user,
    );
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        slotProposalId: "prop-1",
        actionTakenAt: null,
      },
      data: { actionTakenAt: expect.any(Date) as Date },
    });
  });

  it("does not reward LinUCB when the user switches away from it", async () => {
    const { service, schedulingFeedback } = await makeService(
      row(),
      [],
      SchedulingModel.LINUCB,
    );
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );
    expect(schedulingFeedback.onPairwiseWin).not.toHaveBeenCalled();
  });
});
