import type { User } from "../../generated/prisma";
import { ReplanService } from "./replan.service";

interface Proposal {
  excludeSessionIds: string[];
  deadline: Date;
  constraint: { extraOccupied: unknown[] };
}

const USER = { id: "u1", timezone: "UTC" } as User;
const NOW = new Date("2026-10-26T00:00:00Z");
const H = 3_600_000;
const row = (id: string, startH: number, deadlineH: number, minutes = 60) => ({
  id,
  title: id,
  durationMinutes: minutes,
  deadline: new Date(NOW.getTime() + deadlineH * H),
  scheduledStartTime: new Date(NOW.getTime() + startH * H),
  notBefore: null,
  window: null,
});

function setup(rows: ReturnType<typeof row>[]) {
  const prisma = { session: { findMany: jest.fn().mockResolvedValue(rows) } };
  const placement = { proposeSingle: jest.fn() };
  const displacement = { applyMoves: jest.fn() };
  const service = new ReplanService(
    prisma as never,
    placement as never,
    displacement as never,
  );
  return { service, placement, displacement, prisma };
}

describe("ReplanService", () => {
  it("places the least slack first and hands each claim to the next", async () => {
    const relaxed = row("relaxed", 8, 48);
    const urgent = row("urgent", 5, 6);
    const { service, placement } = setup([relaxed, urgent]);
    placement.proposeSingle
      .mockResolvedValueOnce(new Date(NOW.getTime() + 1 * H))
      .mockResolvedValueOnce(new Date(NOW.getTime() + 2 * H));

    const plan = await service.plan(
      USER,
      "2026-10-26",
      "2026-10-30",
      "free",
      NOW,
    );

    const proposed = placement.proposeSingle.mock.calls as [Proposal][];
    expect(proposed[0][0].excludeSessionIds).toEqual(["relaxed", "urgent"]);
    expect(proposed[0][0].deadline).toEqual(urgent.deadline);
    expect(proposed[1][0].constraint.extraOccupied).toEqual([
      { startMs: NOW.getTime() + H, endMs: NOW.getTime() + 2 * H },
    ]);
    expect(plan.moves.map((m) => m.id)).toEqual(["urgent", "relaxed"]);
  });

  it("counts a task that keeps its slot as unchanged, and a miss as unplaced", async () => {
    const same = row("same", 3, 48);
    const stuck = row("stuck", 4, 50);
    const { service, placement } = setup([same, stuck]);
    placement.proposeSingle
      .mockResolvedValueOnce(same.scheduledStartTime)
      .mockResolvedValueOnce(null);

    const plan = await service.plan(
      USER,
      "2026-10-26",
      "2026-10-30",
      "balanced",
      NOW,
    );

    expect(plan.unchanged).toBe(1);
    expect(plan.unplaced).toEqual([{ id: "stuck", title: "stuck" }]);
    expect(plan.moves).toEqual([]);
  });

  it("writes moves under one undo group on apply", async () => {
    const t = row("t", 5, 6);
    const { service, placement, displacement, prisma } = setup([t]);
    placement.proposeSingle.mockResolvedValue(new Date(NOW.getTime() + H));
    prisma.session.findMany
      .mockResolvedValueOnce([t])
      .mockResolvedValueOnce([{ id: "t", durationMinutes: 60 }]);

    const res = await service.apply(USER, "2026-10-26", "2026-10-30", "free");

    expect(res.undoGroupId).toEqual(expect.any(String));
    expect(displacement.applyMoves).toHaveBeenCalledWith(
      "u1",
      [
        {
          id: "t",
          fromMs: t.scheduledStartTime.getTime(),
          toMs: NOW.getTime() + H,
        },
      ],
      expect.any(Function),
      res.undoGroupId,
    );
  });

  it("rejects an inverted range", async () => {
    const { service } = setup([]);
    await expect(
      service.plan(USER, "2026-10-30", "2026-10-26"),
    ).rejects.toThrow("Range must be");
  });
});
