import { Test, type TestingModule } from "@nestjs/testing";
import type { Job } from "bullmq";
import { KillSwitchService } from "../../common/killswitch/killswitch.service";
import { QueueWorkers } from "../../queue/queue-workers.service";
import type { PrepJobData } from "../../queue/queues";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrepPlanProcessor } from "./prep-plan.processor";
import { PrepPlanService } from "./prep-plan.service";

const job = {
  id: "j1",
  data: { userId: "u1", parentSessionId: "p1" },
} as Job<PrepJobData>;

function setup(parent: Record<string, unknown> | null) {
  const prisma = {
    session: { findFirst: jest.fn().mockResolvedValue(parent) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: "u1" }) },
  };
  const prep = {
    planFor: jest.fn().mockResolvedValue({ status: "PLACED", offer: null }),
  };
  const notifications = {
    create: jest.fn().mockResolvedValue({ id: "n1" }),
    notify: jest.fn(),
  };
  return { prisma, prep, notifications };
}

async function build(h: ReturnType<typeof setup>, enabled = true) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PrepPlanProcessor,
      { provide: QueueWorkers, useValue: { register: jest.fn() } },
      {
        provide: KillSwitchService,
        useValue: { isEnabled: jest.fn().mockResolvedValue(enabled) },
      },
      { provide: PrismaService, useValue: h.prisma },
      { provide: PrepPlanService, useValue: h.prep },
      { provide: NotificationsService, useValue: h.notifications },
    ],
  }).compile();
  return module.get(PrepPlanProcessor);
}

describe("PrepPlanProcessor", () => {
  it("plans for a live exam or assignment", async () => {
    const h = setup({
      id: "p1",
      title: "Essay",
      type: "ASSIGNMENT",
      scheduledStartTime: new Date("2026-10-30T00:00:00.000Z"),
      submittedAt: null,
    });
    const processor = await build(h);

    await processor.process(job);

    expect(h.prep.planFor).toHaveBeenCalledWith(
      { id: "u1" },
      {
        id: "p1",
        title: "Essay",
        kind: "ASSIGNMENT",
        deadline: new Date("2026-10-30T00:00:00.000Z"),
      },
      expect.any(Date),
    );
  });

  it("plans a parent already submitted on the LMS, which stays until its deadline", async () => {
    const h = setup({
      id: "p1",
      title: "Essay",
      type: "ASSIGNMENT",
      scheduledStartTime: new Date("2026-10-30T00:00:00.000Z"),
      submittedAt: new Date("2026-10-20T00:00:00.000Z"),
    });
    const processor = await build(h);

    await processor.process(job);

    expect(h.prep.planFor).toHaveBeenCalledTimes(1);
  });

  it("raises a plan offer with both times, in the order the buttons show", async () => {
    const primary = new Date("2026-10-27T10:00:00.000Z");
    const alternative = new Date("2026-10-28T09:00:00.000Z");
    const h = setup({
      id: "p1",
      title: "Essay",
      type: "ASSIGNMENT",
      scheduledStartTime: new Date("2026-10-30T00:00:00.000Z"),
      submittedAt: null,
    });
    h.prep.planFor.mockResolvedValue({
      status: "PLACED",
      sessionId: "prep-1",
      startsAt: primary,
      offer: { slotProposalId: "prop-1", primary, alternative },
    });
    const processor = await build(h);

    await processor.process(job);

    expect(h.notifications.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        eventName: "plan_offer.prep",
        sessionId: "prep-1",
        slotProposalId: "prop-1",
        offerSlots: [primary, alternative],
      }),
    );
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
  });

  it("raises no offer when the plan has one time", async () => {
    const h = setup({
      id: "p1",
      title: "Essay",
      type: "ASSIGNMENT",
      scheduledStartTime: new Date("2026-10-30T00:00:00.000Z"),
      submittedAt: null,
    });
    const processor = await build(h);

    await processor.process(job);

    expect(h.notifications.create).not.toHaveBeenCalled();
  });

  it("drops a parent the student skipped", async () => {
    const h = setup({
      id: "p1",
      title: "Essay",
      type: "ASSIGNMENT",
      scheduledStartTime: new Date("2026-10-30T00:00:00.000Z"),
      submittedAt: null,
      skipped: true,
    });
    const processor = await build(h);

    await processor.process(job);

    expect(h.prep.planFor).not.toHaveBeenCalled();
  });

  it("drops a parent that no longer exists", async () => {
    const h = setup(null);
    const processor = await build(h);

    await processor.process(job);

    expect(h.prep.planFor).not.toHaveBeenCalled();
  });

  it("does nothing while ingestion is switched off", async () => {
    const h = setup(null);
    const processor = await build(h, false);

    await processor.process(job);

    expect(h.prisma.session.findFirst).not.toHaveBeenCalled();
  });
});
