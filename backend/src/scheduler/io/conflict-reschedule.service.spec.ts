import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../../generated/prisma";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import { wouldConflict } from "./conflict-check";
import { ConflictRescheduleService } from "./conflict-reschedule.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TaskPlacementService } from "./task-placement.service";
import { DisplacementService } from "./displacement.service";

jest.mock("./conflict-check", () => ({ wouldConflict: jest.fn() }));
const conflicts = wouldConflict as jest.MockedFunction<typeof wouldConflict>;

const user = { id: "u1", timezone: "UTC" } as unknown as User;
const now = new Date("2026-06-08T00:00:00.000Z");
const deadline = new Date("2026-06-30T00:00:00.000Z");
const at = (iso: string) => new Date(iso);

const row = (id: string, start: string, seriesId: string | null = null) => ({
  id,
  seriesId,
  durationMinutes: 60,
  deadline,
  scheduledStartTime: at(start),
});

type Move = { id: string; fromMs: number; toMs: number };

async function make(rows: ReturnType<typeof row>[]) {
  const prisma = {
    session: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(rows)
        .mockResolvedValue(
          rows.map((r) => ({ id: r.id, durationMinutes: 60 })),
        ),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const placement = {
    placeOnDeadlineChange: jest.fn(),
    planSeriesRespread: jest.fn(),
  };
  const displacement = {
    applyMoves: jest.fn((_u: string, moves: Move[]) =>
      Promise.resolve(
        moves.map((m) => ({
          id: m.id,
          from: new Date(m.fromMs),
          to: new Date(m.toMs),
        })),
      ),
    ),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ConflictRescheduleService,
      { provide: PrismaService, useValue: prisma },
      { provide: TaskPlacementService, useValue: placement },
      { provide: DisplacementService, useValue: displacement },
    ],
  }).compile();
  const svc = module.get<ConflictRescheduleService>(ConflictRescheduleService);
  return { svc, prisma, placement, displacement };
}

beforeEach(() => {
  conflicts.mockReset();
  conflicts.mockResolvedValue(true);
});

describe("ConflictRescheduleService.rescheduleAll", () => {
  it("moves a lone conflicting task through single placement", async () => {
    const { svc, placement, displacement } = await make([
      row("t", "2026-06-09T09:00:00.000Z"),
    ]);
    const to = at("2026-06-09T13:00:00.000Z");
    placement.placeOnDeadlineChange.mockResolvedValue({
      scheduledStartTime: to,
    });

    const res = await svc.rescheduleAll(user, ["t"], now);

    expect(res.rescheduled).toEqual([
      { id: "t", from: at("2026-06-09T09:00:00.000Z"), to },
    ]);
    expect(displacement.applyMoves).toHaveBeenCalledTimes(1);
    expect(placement.planSeriesRespread).not.toHaveBeenCalled();
  });

  it("falls back to single placement when the respread leaves a sitting unplaced", async () => {
    const { svc, placement, displacement } = await make([
      row("a", "2026-06-09T09:00:00.000Z", "s1"),
    ]);
    placement.planSeriesRespread.mockResolvedValue([
      { id: "a", from: at("2026-06-09T09:00:00.000Z"), to: null },
    ]);
    placement.placeOnDeadlineChange.mockResolvedValue({
      scheduledStartTime: at("2026-06-10T09:00:00.000Z"),
    });

    const res = await svc.rescheduleAll(user, ["a"], now);

    expect(placement.placeOnDeadlineChange).toHaveBeenCalledTimes(1);
    expect(displacement.applyMoves).toHaveBeenCalledTimes(1);
    expect(res.rescheduled).toHaveLength(1);
  });

  it("one task that can't be placed is reported, the rest still move", async () => {
    const { svc, placement } = await make([
      row("x", "2026-06-09T09:00:00.000Z"),
      row("y", "2026-06-10T09:00:00.000Z"),
    ]);
    placement.placeOnDeadlineChange
      .mockRejectedValueOnce(new ScheduleInfeasibleException())
      .mockResolvedValueOnce({
        scheduledStartTime: at("2026-06-10T13:00:00.000Z"),
      });

    const res = await svc.rescheduleAll(user, ["x", "y"], now);

    expect(res.failedSessionIds).toEqual(["x"]);
    expect(res.rescheduled.map((r) => r.id)).toEqual(["y"]);
  });

  it("leaves tasks that no longer conflict alone", async () => {
    conflicts.mockResolvedValue(false);
    const { svc, placement, displacement } = await make([
      row("t", "2026-06-09T09:00:00.000Z", "s1"),
    ]);

    const res = await svc.rescheduleAll(user, ["t"], now);

    expect(res).toEqual({ rescheduled: [], failedSessionIds: [] });
    expect(placement.planSeriesRespread).not.toHaveBeenCalled();
    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
    expect(displacement.applyMoves).not.toHaveBeenCalled();
  });
});
