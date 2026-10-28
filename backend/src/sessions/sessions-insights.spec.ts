import type { User } from "../../generated/prisma";
import { PlacementPlanService } from "./placement-plan.service";
import { ReplanService } from "./replan.service";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

const USER = {
  id: "u1",
  timezone: "Asia/Ho_Chi_Minh",
  preferenceMatrix: [],
} as unknown as User;

function setup() {
  const sessions = {
    list: jest.fn().mockResolvedValue({ sessions: [] }),
  };
  const placement = {
    undoLatest: jest.fn().mockResolvedValue({ restored: ["a", "b"] }),
  };
  const replans = {
    plan: jest.fn().mockResolvedValue({ moves: [] }),
    apply: jest.fn().mockResolvedValue({ groupId: "g1" }),
  };
  const controller = new SessionsController(
    sessions as unknown as SessionsService,
    placement as unknown as PlacementPlanService,
    replans as unknown as ReplanService,
  );
  return { controller, sessions, placement, replans };
}

describe("SessionsController insights", () => {
  it("lists the range once for the recap", async () => {
    const { controller, sessions } = setup();
    const got = await controller.recap(
      { from: "2026-10-26", to: "2026-11-01" },
      USER,
    );
    expect(sessions.list).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-10-26", to: "2026-11-01" }),
      USER,
    );
    expect(got.success).toBe(true);
    expect(got.data).toBeDefined();
  });

  it("finds free slots for the requested duration", async () => {
    const { controller, sessions } = setup();
    const got = await controller.freeSlots(
      { from: "2026-10-26", to: "2026-10-26", durationMinutes: 60 },
      USER,
    );
    expect(sessions.list).toHaveBeenCalledTimes(1);
    expect(got.data).toBeDefined();
  });

  it("previews a replan without applying it", async () => {
    const { controller, replans } = setup();
    await controller.replan(
      { from: "2026-10-26", to: "2026-10-27", change: "free" },
      USER,
    );
    expect(replans.plan).toHaveBeenCalledWith(
      USER,
      "2026-10-26",
      "2026-10-27",
      "free",
    );
    expect(replans.apply).not.toHaveBeenCalled();
  });

  it("applies a replan on confirm", async () => {
    const { controller, replans } = setup();
    await controller.confirmReplan(
      { from: "2026-10-26", to: "2026-10-27" },
      USER,
    );
    expect(replans.apply).toHaveBeenCalledWith(
      USER,
      "2026-10-26",
      "2026-10-27",
      undefined,
    );
  });

  it("undoes the latest change and counts what it restored", async () => {
    const { controller } = setup();
    const got = await controller.undoLatest(USER);
    expect(got.message).toBe("Restored 2 session(s)");
  });
});
